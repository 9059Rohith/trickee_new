from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.services.daily_plan_tools import (
    DailyPlanTools,
    estimate_leg_energy,
    evaluate_charging_opportunity,
)


class _Response:
    def __init__(self, payload: dict, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://provider.invalid")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("provider error", request=request, response=response)

    def json(self):
        return self.payload


class _Client:
    def __init__(self, *, post_response=None, get_response=None, raises=None):
        self.post_response = post_response
        self.get_response = get_response
        self.raises = raises

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def post(self, *_args, **_kwargs):
        if self.raises:
            raise self.raises
        return self.post_response

    def get(self, *_args, **_kwargs):
        if self.raises:
            raise self.raises
        return self.get_response


def test_unconfigured_provider_returns_degraded_evidence_not_fake_coordinates():
    tools = DailyPlanTools(api_key="")

    place = tools.resolve_destination("Surat railway station")
    route = tools.plan_route_leg(
        {"lat": 21.1, "lng": 72.8},
        {"lat": 21.2, "lng": 72.9},
        datetime(2026, 9, 9, 9, 0, tzinfo=timezone.utc),
    )

    assert place["coordinates"] is None
    assert place["degraded_reason"] == "google_places_not_configured"
    assert route["distance_m"] is None
    assert route["degraded_reason"] == "google_routes_not_configured"


def test_provider_timeout_is_sanitized_and_never_claims_live_data():
    tools = DailyPlanTools(
        api_key="configured",
        client_factory=lambda _timeout: _Client(raises=httpx.ReadTimeout("secret upstream detail")),
    )

    result = tools.resolve_destination("Office")

    assert result["coordinates"] is None
    assert result["source"] == "unavailable"
    assert result["degraded_reason"] == "google_places_timeout"
    assert "secret" not in str(result)


def test_energy_is_sequential_and_missing_capacity_is_not_zero():
    known = estimate_leg_energy(distance_m=12_000, starting_soc_pct=80, usable_kwh=3.0, wh_per_km=45)
    unknown = estimate_leg_energy(distance_m=12_000, starting_soc_pct=80, usable_kwh=None, wh_per_km=45)

    assert known["energy_wh"] == 540.0
    assert known["arrival_soc_pct"] == 62.0
    assert unknown["energy_wh"] is None
    assert unknown["arrival_soc_pct"] is None
    assert unknown["degraded_reason"] == "usable_capacity_unavailable"


def test_charger_place_is_not_presented_as_live_availability_or_known_power():
    result = evaluate_charging_opportunity(
        charger={"name": "Station", "source": "google_places", "power_kw": None},
        current_soc_pct=30,
        battery_capacity_kwh=3.0,
        dwell_minutes=30,
    )

    assert result["place_confirmed"] is True
    assert result["availability_confirmed"] is False
    assert result["estimated_soc_gain_pct"] is None
    assert result["recommended"] is False
    assert "charger_power_unconfirmed" in result["reasons"]
