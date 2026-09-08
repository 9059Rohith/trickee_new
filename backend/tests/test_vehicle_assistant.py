from app.services.vehicle_assistant import VehicleAssistant


SUMMARY = {
    "vehicle_code": "LIVE-EV",
    "latest_prediction": {"wh_per_km": 44.0, "confidence": "medium"},
    "soc": {"value": 18.0, "is_recent": True},
    "estimated_range_km": 12.0,
}


def test_unconfigured_llm_returns_truthful_function_rendered_fallback():
    result = VehicleAssistant(api_key="").answer(
        message="Should I charge now?",
        summary=SUMMARY,
    )

    assert result["llm_used"] is False
    assert result["tools_called"] == ["gps_vehicle_summary"]
    assert "18.0%" in result["answer"]
    assert result["error_code"] == "llm_not_configured"


def test_llm_can_only_answer_after_calling_authoritative_status_tool():
    requests = []

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, _url, *, json, headers):
            requests.append(json)

            class Response:
                def raise_for_status(self):
                    return None

                def json(self):
                    if len(requests) == 1:
                        return {
                            "choices": [
                                {
                                    "message": {
                                        "role": "assistant",
                                        "tool_calls": [
                                            {
                                                "id": "call-1",
                                                "type": "function",
                                                "function": {
                                                    "name": "gps_vehicle_summary",
                                                    "arguments": "{}",
                                                },
                                            }
                                        ],
                                    }
                                }
                            ]
                        }
                    return {
                        "choices": [
                            {
                                "message": {
                                    "content": "Your verified SOC is 18%, so charge before the long leg."
                                }
                            }
                        ]
                    }

            return Response()

    result = VehicleAssistant(
        api_key="configured",
        model="test-model",
        client_factory=lambda _timeout: Client(),
    ).answer(message="Should I charge now?", summary=SUMMARY)

    assert result["llm_used"] is True
    assert result["error_code"] is None
    assert "verified SOC" in result["answer"]
    assert requests[1]["messages"][-1]["role"] == "tool"
    assert '"value": 18.0' in requests[1]["messages"][-1]["content"]
