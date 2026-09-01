"""Build provenance-safe observed energy labels from finalized trip inputs."""
from __future__ import annotations

from datetime import datetime
from math import isfinite

from app.models.entities import MobileTripSession, TripEnergyLabel, Vehicle


MIN_SOC_DELTA_PCT = 5.0
MIN_DISTANCE_KM = 10.0
MIN_GPS_COMPLETENESS_PCT = 90.0
MIN_PHYSICAL_WH_PER_KM = 5.0
MAX_PHYSICAL_WH_PER_KM = 300.0


def _finite_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if isfinite(result) else None


def build_trip_energy_label(
    trip: MobileTripSession,
    vehicle: Vehicle,
    distance_km: float | None,
    gps_completeness_pct: float,
    charging_observed: bool,
    captured_at: datetime,
) -> TripEnergyLabel:
    """Return an unpersisted label using only observed SOC and vehicle capacity."""

    context = trip.context or {}
    starting_soc = _finite_float(context.get("starting_soc"))
    ending_soc = _finite_float(context.get("ending_soc"))
    usable_kwh = _finite_float(vehicle.usable_kwh)
    distance = _finite_float(distance_km)
    gps_completeness = _finite_float(gps_completeness_pct)

    soc_delta = starting_soc - ending_soc if starting_soc is not None and ending_soc is not None else None
    energy_wh = (
        soc_delta / 100.0 * usable_kwh * 1000.0
        if soc_delta is not None and usable_kwh is not None
        else None
    )
    wh_per_km = energy_wh / distance if energy_wh is not None and distance is not None and distance > 0 else None

    if starting_soc is None or ending_soc is None:
        reason = "missing_soc"
    elif soc_delta is not None and soc_delta < 0:
        reason = "soc_increase"
    elif soc_delta is not None and soc_delta < MIN_SOC_DELTA_PCT:
        reason = "soc_delta_below_5_pct"
    elif distance is None or distance < MIN_DISTANCE_KM:
        reason = "distance_below_10_km"
    elif gps_completeness is None or gps_completeness < MIN_GPS_COMPLETENESS_PCT:
        reason = "gps_completeness_below_90_pct"
    elif charging_observed:
        reason = "charging_observed"
    elif (
        usable_kwh is None
        or usable_kwh <= 0
        or wh_per_km is None
        or not MIN_PHYSICAL_WH_PER_KM <= wh_per_km <= MAX_PHYSICAL_WH_PER_KM
    ):
        reason = "physical_bounds_failed"
    else:
        reason = "eligible_manual_dashboard"

    eligible = reason == "eligible_manual_dashboard"
    return TripEnergyLabel(
        trip_id=trip.id,
        starting_soc_pct=starting_soc,
        ending_soc_pct=ending_soc,
        soc_delta_pct=soc_delta,
        actual_energy_consumed_wh=energy_wh,
        actual_wh_per_km=wh_per_km,
        usable_kwh_snapshot=usable_kwh,
        label_source="manual_dashboard",
        label_confidence=0.60 if eligible else 0.30,
        is_training_eligible=eligible,
        eligibility_reason=reason,
        captured_at=captured_at,
    )
