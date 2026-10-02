from datetime import datetime
import pytest

from app.models.entities import MobileTripSession, TripEnergyLabel, Vehicle
from app.services.trip_energy_labels import build_trip_energy_label


CAPTURED_AT = datetime(2026, 8, 30, 12, 0)


def _trip(starting_soc=90.0, ending_soc=80.0) -> MobileTripSession:
    return MobileTripSession(context={"starting_soc": starting_soc, "ending_soc": ending_soc})


def _vehicle(usable_kwh=2.98) -> Vehicle:
    return Vehicle(usable_kwh=usable_kwh)


def _label(**overrides) -> TripEnergyLabel:
    values = {
        "trip": _trip(),
        "vehicle": _vehicle(),
        "distance_km": 20.0,
        "gps_completeness_pct": 98.0,
        "charging_observed": False,
        "captured_at": CAPTURED_AT,
    }
    values.update(overrides)
    return build_trip_energy_label(**values)


def test_model_exposes_only_the_approved_persisted_columns():
    assert set(TripEnergyLabel.__table__.columns.keys()) == {
        "id",
        "trip_id",
        "starting_soc_pct",
        "ending_soc_pct",
        "soc_delta_pct",
        "actual_energy_consumed_wh",
        "actual_wh_per_km",
        "usable_kwh_snapshot",
        "label_source",
        "label_confidence",
        "is_training_eligible",
        "eligibility_reason",
        "captured_at",
        "created_at",
        "updated_at",
    }


def test_manual_dashboard_label_uses_capacity_snapshot_and_normalized_target():
    label = _label()

    assert label.actual_energy_consumed_wh == pytest.approx(298.0)
    assert label.actual_wh_per_km == pytest.approx(14.9)
    assert label.usable_kwh_snapshot == 2.98
    assert label.label_source == "manual_dashboard"
    assert label.label_confidence == 0.60
    assert label.is_training_eligible is True
    assert label.eligibility_reason == "eligible_manual_dashboard"
    assert label.captured_at == CAPTURED_AT


def test_prediction_values_can_never_be_substituted_for_missing_soc():
    label = _label(trip=_trip(starting_soc=None, ending_soc=80.0))

    assert label.actual_energy_consumed_wh is None
    assert label.actual_wh_per_km is None
    assert label.is_training_eligible is False
    assert label.eligibility_reason == "missing_soc"
    assert label.label_confidence == 0.30


def test_vehicle_charging_invalidates_start_to_end_energy_target():
    label = _label(charging_observed=True)

    assert label.starting_soc_pct == 90.0
    assert label.ending_soc_pct == 80.0
    assert label.actual_energy_consumed_wh is None
    assert label.actual_wh_per_km is None
    assert label.is_training_eligible is False
    assert label.eligibility_reason == "charging_observed"


def test_vehicle_charging_remains_the_exclusion_reason_on_a_short_trip():
    label = _label(charging_observed=True, distance_km=2.0)

    assert label.eligibility_reason == "charging_observed"
    assert label.actual_energy_consumed_wh is None


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"trip": _trip(starting_soc=80.0, ending_soc=90.0)}, "soc_increase"),
        ({"trip": _trip(starting_soc=90.0, ending_soc=86.0)}, "soc_delta_below_5_pct"),
        ({"distance_km": 9.99}, "distance_below_10_km"),
        ({"gps_completeness_pct": 89.99}, "gps_completeness_below_90_pct"),
        ({"charging_observed": True}, "charging_observed"),
        ({"vehicle": _vehicle(usable_kwh=100.0)}, "physical_bounds_failed"),
    ],
)
def test_training_exclusions_are_deterministic(overrides, reason):
    label = _label(**overrides)

    assert label.is_training_eligible is False
    assert label.eligibility_reason == reason
    assert label.label_confidence == 0.30


def test_exclusion_order_is_stable():
    label = _label(
        trip=_trip(starting_soc=None, ending_soc=90.0),
        distance_km=1.0,
        gps_completeness_pct=1.0,
        charging_observed=True,
    )

    assert label.eligibility_reason == "missing_soc"
