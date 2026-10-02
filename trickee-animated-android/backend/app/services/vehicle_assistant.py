from __future__ import annotations

import json
from typing import Callable, Protocol

import httpx

from app.config import get_settings


class HttpClient(Protocol):
    def __enter__(self): ...
    def __exit__(self, exc_type, exc, traceback): ...
    def post(self, url: str, *, json: dict, headers: dict[str, str]): ...


class VehicleAssistant:
    """LLM wording boundary; the database-backed summary owns every fact."""

    tool_name = "gps_vehicle_summary"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        client_factory: Callable[[float], HttpClient] | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = settings.groq_api_key if api_key is None else api_key
        self.model = model or settings.groq_model
        self.timeout_seconds = settings.llm_timeout_seconds
        self.client_factory = client_factory or (
            lambda timeout: httpx.Client(timeout=timeout)
        )

    @staticmethod
    def _fallback(
        summary: dict,
        location_context: dict | None = None,
        nearby_chargers: list[dict] | None = None,
    ) -> str:
        prediction = summary.get("latest_prediction") or {}
        soc = summary.get("soc") or {}
        parts = ["I can only report verified or explicitly estimated GPS-first data."]
        if prediction.get("wh_per_km") is not None:
            parts.append(
                f"Estimated efficiency is {prediction['wh_per_km']:.1f} Wh/km "
                f"with {prediction.get('confidence') or 'low'} confidence."
            )
        if soc.get("is_recent") and soc.get("value") is not None:
            parts.append(f"The latest SOC reading is {soc['value']:.1f}%.")
        else:
            parts.append(
                "Add a recent SOC reading before using any remaining-range estimate."
            )
        if summary.get("estimated_range_km") is not None:
            parts.append(
                f"Estimated remaining range is {summary['estimated_range_km']:.1f} km."
            )
        if location_context:
            parts.append(
                "Current phone location is "
                f"{location_context['lat']:.5f}, {location_context['lng']:.5f}."
            )
        if nearby_chargers:
            charger = nearby_chargers[0]
            name = charger.get("name") or "the nearest verified charger listing"
            address = charger.get("formatted_address")
            where = f" at {address}" if address else ""
            parts.append(
                f"The nearest Google Places result is {name}{where}; "
                "live availability is not confirmed."
            )
        return " ".join(parts)[:1000]

    def answer(
        self,
        *,
        message: str,
        summary: dict,
        location_context: dict | None = None,
        nearby_chargers: list[dict] | None = None,
    ) -> dict:
        nearby_chargers = nearby_chargers or []
        fallback = self._fallback(summary, location_context, nearby_chargers)
        tools_called = [self.tool_name]
        if location_context:
            tools_called.append("current_location_context")
        if nearby_chargers:
            tools_called.append("nearby_chargers")
        base = {
            "answer": fallback,
            "tools_called": tools_called,
            "llm_used": False,
            "model_name": self.model if self.api_key else None,
            "error_code": "llm_not_configured" if not self.api_key else None,
            "location_used": location_context is not None,
            "charger_context_used": bool(nearby_chargers),
        }
        if not self.api_key:
            return base

        tools = [
            {
                "type": "function",
                "function": {
                    "name": self.tool_name,
                    "description": "Read the authenticated driver's authoritative GPS vehicle summary.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False,
                    },
                },
            }
        ]
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Trickee's EV driving assistant. You must call "
                    "gps_vehicle_summary before answering. Use only tool facts. "
                    "Distinguish measured values from estimates, never invent live "
                    "traffic, charger availability, battery SOC, routes, or numbers."
                ),
            },
            {"role": "user", "content": message[:1000]},
        ]
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        try:
            with self.client_factory(self.timeout_seconds) as client:
                first_response = client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    json={
                        "model": self.model,
                        "messages": messages,
                        "temperature": 0.1,
                        "max_tokens": 250,
                        "tool_choice": "required",
                        "tools": tools,
                    },
                    headers=headers,
                )
                first_response.raise_for_status()
                assistant = first_response.json().get("choices", [{}])[0].get(
                    "message", {}
                )
                calls = assistant.get("tool_calls") or []
                if len(calls) != 1:
                    return {**base, "error_code": "llm_tool_missing"}
                call = calls[0]
                function = call.get("function") or {}
                if function.get("name") != self.tool_name:
                    return {**base, "error_code": "llm_tool_not_allowed"}
                json.loads(function.get("arguments") or "{}")

                grounded_messages = [
                    *messages,
                    assistant,
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id"),
                        "name": self.tool_name,
                        "content": json.dumps(
                            {
                                "vehicle_summary": summary,
                                "current_location": location_context,
                                "nearby_chargers": nearby_chargers,
                            },
                            default=str,
                            sort_keys=True,
                        ),
                    },
                ]
                final_response = client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    json={
                        "model": self.model,
                        "messages": grounded_messages,
                        "temperature": 0.1,
                        "max_tokens": 350,
                        "tool_choice": "none",
                        "tools": tools,
                    },
                    headers=headers,
                )
                final_response.raise_for_status()
                answer = (
                    final_response.json()
                    .get("choices", [{}])[0]
                    .get("message", {})
                    .get("content")
                )
            if not isinstance(answer, str) or not answer.strip():
                return {**base, "error_code": "llm_answer_missing"}
            return {
                "answer": answer.strip()[:1000],
                "tools_called": tools_called,
                "llm_used": True,
                "model_name": self.model,
                "error_code": None,
                "location_used": location_context is not None,
                "charger_context_used": bool(nearby_chargers),
            }
        except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            return {**base, "error_code": "llm_unavailable"}


vehicle_assistant = VehicleAssistant()
