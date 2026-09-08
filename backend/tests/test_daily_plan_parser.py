from datetime import date

import pytest

from app.services.daily_plan_parser import parse_daily_plan


def test_parser_extracts_ordered_stops_and_normalizes_twelve_and_twenty_four_hour_times():
    parsed = parse_daily_plan(
        "Office at 9:00 am, client meeting at 12:30 PM, warehouse at 16:00, home by 7 pm",
        service_date=date(2026, 9, 9),
        timezone_name="Asia/Kolkata",
    )

    assert [stop.label for stop in parsed.stops] == [
        "Office",
        "client meeting",
        "warehouse",
        "home",
    ]
    assert [stop.requested_arrival_local for stop in parsed.stops] == [
        "09:00",
        "12:30",
        "16:00",
        "19:00",
    ]
    assert parsed.parser_source == "deterministic_schedule_parser"
    assert parsed.warnings == []


def test_parser_preserves_ambiguous_stop_without_fabricating_a_time():
    parsed = parse_daily_plan(
        "Office at 9 am, visit client, home at 7 pm",
        service_date=date(2026, 9, 9),
        timezone_name="Asia/Kolkata",
    )

    assert parsed.stops[1].label == "visit client"
    assert parsed.stops[1].requested_arrival_local is None
    assert parsed.stops[1].status == "needs_confirmation"
    assert parsed.warnings == ["Add an arrival time for visit client."]


def test_parser_rejects_unbounded_or_empty_messages():
    with pytest.raises(ValueError, match="between 3 and 2000"):
        parse_daily_plan("x" * 2001, date(2026, 9, 9), "Asia/Kolkata")
    with pytest.raises(ValueError, match="at least one stop"):
        parse_daily_plan("   ", date(2026, 9, 9), "Asia/Kolkata")
