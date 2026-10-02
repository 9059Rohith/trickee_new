from datetime import date

from app.services.daily_plan_conversation import DailyPlanConversation


def test_fallback_still_calls_authoritative_parser_when_llm_is_unconfigured():
    result = DailyPlanConversation(api_key="").handle(
        message="Office at 9 am, home at 7 pm",
        service_date=date(2026, 9, 9),
        timezone_name="Asia/Kolkata",
    )

    assert [stop.label for stop in result.plan.stops] == ["Office", "home"]
    assert result.llm_fallback_used is True
    assert result.tool_calls == ["parse_day_schedule"]
    assert "09:00" in result.reply


def test_unknown_llm_tool_is_rejected_and_parser_remains_authoritative():
    class BadToolClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, *_args, **_kwargs):
            class Response:
                def raise_for_status(self):
                    return None

                def json(self):
                    return {"choices": [{"message": {"tool_calls": [{"function": {"name": "open_url", "arguments": "{}"}}]}}]}

            return Response()

    result = DailyPlanConversation(
        api_key="configured",
        client_factory=lambda _timeout: BadToolClient(),
    ).handle(
        message="Office at 9 am",
        service_date=date(2026, 9, 9),
        timezone_name="Asia/Kolkata",
    )

    assert result.llm_fallback_used is True
    assert result.error_code == "llm_tool_not_allowed"
    assert result.tool_calls == ["parse_day_schedule"]
