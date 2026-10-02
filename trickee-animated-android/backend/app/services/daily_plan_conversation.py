from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Callable, Protocol

import httpx

from app.config import get_settings
from app.services.daily_plan_parser import ParsedDailyPlan, parse_daily_plan


class HttpClient(Protocol):
    def __enter__(self): ...
    def __exit__(self, exc_type, exc, traceback): ...
    def post(self, url: str, *, json: dict, headers: dict[str, str]): ...


@dataclass(frozen=True)
class ConversationResult:
    plan: ParsedDailyPlan
    reply: str
    tool_calls: list[str]
    llm_fallback_used: bool
    model_name: str | None = None
    error_code: str | None = None


class DailyPlanConversation:
    """LLM conversation boundary; deterministic functions own every plan fact."""

    allowed_tools = {"parse_day_schedule"}

    def __init__(self, *, api_key: str | None = None, model: str | None = None, client_factory: Callable[[float], HttpClient] | None = None) -> None:
        settings = get_settings()
        self.api_key = settings.groq_api_key if api_key is None else api_key
        self.model = model or settings.groq_model
        self.timeout_seconds = settings.llm_timeout_seconds
        self.client_factory = client_factory or (lambda timeout: httpx.Client(timeout=timeout))

    @staticmethod
    def _fallback_reply(plan: ParsedDailyPlan) -> str:
        stops = ", ".join(
            f"{stop.label} at {stop.requested_arrival_local}" if stop.requested_arrival_local else f"{stop.label} (time needed)"
            for stop in plan.stops
        )
        suffix = " Please add the missing time before confirming." if plan.warnings else " Please confirm this schedule."
        return f"I found {len(plan.stops)} stops: {stops}.{suffix}"[:1000]

    def handle(self, *, message: str, service_date: date, timezone_name: str) -> ConversationResult:
        # Execute the authoritative function even if the language provider is absent or malicious.
        plan = parse_daily_plan(message, service_date, timezone_name)
        fallback = self._fallback_reply(plan)
        if not self.api_key:
            return ConversationResult(plan, fallback, ["parse_day_schedule"], True, error_code="llm_not_configured")

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are Trickee's daily schedule assistant. Call parse_day_schedule. Never invent locations, routes, traffic, SOC, charging availability, or numeric estimates."},
                {"role": "user", "content": message[:2000]},
            ],
            "temperature": 0.1,
            "max_tokens": 350,
            "tool_choice": "required",
            "tools": [{"type": "function", "function": {"name": "parse_day_schedule", "description": "Parse the driver's schedule using the deterministic server parser.", "parameters": {"type": "object", "properties": {"message": {"type": "string"}}, "required": ["message"], "additionalProperties": False}}}],
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        try:
            with self.client_factory(self.timeout_seconds) as client:
                response = client.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers)
                response.raise_for_status()
                assistant = response.json().get("choices", [{}])[0].get("message", {})
            calls = assistant.get("tool_calls") or []
            if not calls:
                return ConversationResult(plan, fallback, ["parse_day_schedule"], True, self.model, "llm_tool_missing")
            for call in calls[:4]:
                name = (call.get("function") or {}).get("name")
                if name not in self.allowed_tools:
                    return ConversationResult(plan, fallback, ["parse_day_schedule"], True, self.model, "llm_tool_not_allowed")
                # Parse arguments only to enforce valid JSON. The original bounded request remains authoritative.
                json.loads((call.get("function") or {}).get("arguments") or "{}")
            # A second model turn is intentionally unnecessary: the safe reply is rendered from tool output.
            return ConversationResult(plan, fallback, ["parse_day_schedule"], False, self.model)
        except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            return ConversationResult(plan, fallback, ["parse_day_schedule"], True, self.model, "llm_unavailable")


daily_plan_conversation = DailyPlanConversation()
