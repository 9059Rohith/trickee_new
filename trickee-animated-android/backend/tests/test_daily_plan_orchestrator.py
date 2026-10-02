from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.services.daily_plan_orchestrator import build_plan_result


class FakeTools:
    def resolve_destination(self, query):
        destinations = {
            "Office": {"lat": 21.17, "lng": 72.83},
            "Home": {"lat": 21.20, "lng": 72.85},
        }
        return {"query": query, "name": query, "coordinates": destinations[query], "source": "test_places", "evidence_at": "2026-09-08T00:00:00Z", "confidence": 1.0, "degraded_reason": None}

    def plan_route_leg(self, origin, destination, departure_at):
        return {"distance_m": 10_000, "duration_s": 1800, "traffic_delay_s": 300, "source": "test_routes", "evidence_at": "2026-09-08T00:00:00Z", "confidence": 1.0, "degraded_reason": None}

    def find_route_chargers(self, center, radius_m=5000):
        return []


def test_soc_is_carried_sequentially_between_legs():
    result = build_plan_result(
        stops=[
            {"label": "Office", "requested_arrival_local": "09:00", "status": "unresolved"},
            {"label": "Home", "requested_arrival_local": "19:00", "status": "unresolved"},
        ],
        service_date=date(2026, 9, 9), timezone_name="Asia/Kolkata",
        origin={"lat": 21.15, "lng": 72.80}, starting_soc_pct=80,
        usable_kwh=2.0, wh_per_km=40, tools=FakeTools(),
        now=datetime(2026, 9, 8, 12, 0, tzinfo=ZoneInfo("Asia/Kolkata")),
    )

    assert result["legs"][0]["arrival_soc_pct"] == 60.0
    assert result["legs"][1]["starting_soc_pct"] == 60.0
    assert result["legs"][1]["arrival_soc_pct"] == 40.0


def test_unresolved_stop_blocks_route_and_numeric_claims():
    class Unresolved(FakeTools):
        def resolve_destination(self, query):
            return {"query": query, "coordinates": None, "source": "unavailable", "degraded_reason": "google_places_unavailable", "confidence": 0.0}

    result = build_plan_result(
        stops=[{"label": "Unknown", "requested_arrival_local": "09:00", "status": "unresolved"}],
        service_date=date(2026, 9, 9), timezone_name="Asia/Kolkata",
        origin={"lat": 21.15, "lng": 72.80}, starting_soc_pct=80,
        usable_kwh=2.0, wh_per_km=40, tools=Unresolved(),
    )

    leg = result["legs"][0]
    assert leg["distance_m"] is None
    assert leg["arrival_soc_pct"] is None
    assert leg["degraded_reason"] == "google_places_unavailable"


def test_past_schedule_is_rejected_before_calling_google_routes():
    class RoutesMustNotBeCalled(FakeTools):
        def plan_route_leg(self, origin, destination, departure_at):
            raise AssertionError("past schedules must not call Google Routes")

    result = build_plan_result(
        stops=[{"label": "Office", "requested_arrival_local": "17:00", "status": "unresolved"}],
        service_date=date(2026, 9, 9), timezone_name="Asia/Kolkata",
        origin={"lat": 21.15, "lng": 72.80}, starting_soc_pct=80,
        usable_kwh=2.0, wh_per_km=40, tools=RoutesMustNotBeCalled(),
        now=datetime(2026, 9, 9, 18, 10, tzinfo=ZoneInfo("Asia/Kolkata")),
    )

    leg = result["legs"][0]
    assert leg["distance_m"] is None
    assert leg["arrival_soc_pct"] is None
    assert leg["degraded_reason"] == "schedule_time_in_past"


def test_imminent_arrival_never_sends_a_past_departure_to_google_routes():
    class CapturingTools(FakeTools):
        route_departure = None

        def plan_route_leg(self, origin, destination, departure_at):
            self.route_departure = departure_at
            return super().plan_route_leg(origin, destination, departure_at)

    tools = CapturingTools()
    now = datetime(2026, 9, 9, 18, 10, tzinfo=ZoneInfo("Asia/Kolkata"))
    build_plan_result(
        stops=[{"label": "Office", "requested_arrival_local": "18:20", "status": "unresolved"}],
        service_date=date(2026, 9, 9), timezone_name="Asia/Kolkata",
        origin={"lat": 21.15, "lng": 72.80}, starting_soc_pct=80,
        usable_kwh=2.0, wh_per_km=40, tools=tools, now=now,
    )

    assert tools.route_departure > now
