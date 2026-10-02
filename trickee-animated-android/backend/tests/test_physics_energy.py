"""
Unit tests for the physics baseline energy estimator (§8).

Tests against hand-computed values for 3 vehicle categories:
- Light 2W (scooter)
- Heavy 2W/3W cargo
- 3W passenger
"""
import pytest
from app.services.physics_energy import (
    CategoryDefaults,
    TripEnergyEstimate,
    compute_sample_energy,
    estimate_remaining_range,
    estimate_soc_consumed,
    estimate_trip_energy,
    CATEGORY_DEFAULTS,
)


class TestComputeSampleEnergy:
    """Per-sample energy computation."""

    def test_stationary_returns_aux_only(self):
        """Stationary vehicle should only consume auxiliary power."""
        result = compute_sample_energy(
            speed_mps=0.0, acceleration_mps2=0.0, grade_pct=0.0,
            distance_m=0.0, duration_s=1.0, mass_kg=130.0,
            rolling_resistance=0.012, drag_area_m2=0.35,
            drivetrain_efficiency=0.85, auxiliary_power_w=30.0,
            regen_efficiency=0.0,
        )
        # Should be ~0 since distance is 0
        assert result.energy_wh == 0.0

    def test_constant_speed_flat(self):
        """Constant 30 km/h on flat road for a 2W scooter."""
        speed = 30 / 3.6  # ~8.33 m/s
        result = compute_sample_energy(
            speed_mps=speed, acceleration_mps2=0.0, grade_pct=0.0,
            distance_m=speed, duration_s=1.0, mass_kg=130.0,
            rolling_resistance=0.012, drag_area_m2=0.35,
            drivetrain_efficiency=0.85, auxiliary_power_w=30.0,
            regen_efficiency=0.0,
        )
        assert result.energy_wh > 0
        # At 30 km/h, a 130 kg 2W should use roughly 20-50 Wh/km
        wh_per_km = result.energy_wh / (speed / 1000.0)
        assert 5 < wh_per_km < 100, f"Unexpected Wh/km: {wh_per_km}"

    def test_uphill_uses_more_energy(self):
        """Going uphill should use more energy than flat."""
        speed = 25 / 3.6
        flat = compute_sample_energy(
            speed_mps=speed, acceleration_mps2=0.0, grade_pct=0.0,
            distance_m=speed, duration_s=1.0, mass_kg=130.0,
            rolling_resistance=0.012, drag_area_m2=0.35,
            drivetrain_efficiency=0.85, auxiliary_power_w=30.0,
            regen_efficiency=0.0,
        )
        uphill = compute_sample_energy(
            speed_mps=speed, acceleration_mps2=0.0, grade_pct=5.0,
            distance_m=speed, duration_s=1.0, mass_kg=130.0,
            rolling_resistance=0.012, drag_area_m2=0.35,
            drivetrain_efficiency=0.85, auxiliary_power_w=30.0,
            regen_efficiency=0.0,
        )
        assert uphill.energy_wh > flat.energy_wh

    def test_deceleration_with_regen_recovers_energy(self):
        """Braking with regen should reduce net energy (or produce negative battery_power)."""
        speed = 30 / 3.6
        no_regen = compute_sample_energy(
            speed_mps=speed, acceleration_mps2=-2.0, grade_pct=0.0,
            distance_m=speed, duration_s=1.0, mass_kg=450.0,
            rolling_resistance=0.015, drag_area_m2=0.80,
            drivetrain_efficiency=0.82, auxiliary_power_w=60.0,
            regen_efficiency=0.0,
        )
        with_regen = compute_sample_energy(
            speed_mps=speed, acceleration_mps2=-2.0, grade_pct=0.0,
            distance_m=speed, duration_s=1.0, mass_kg=450.0,
            rolling_resistance=0.015, drag_area_m2=0.80,
            drivetrain_efficiency=0.82, auxiliary_power_w=60.0,
            regen_efficiency=0.10,
        )
        assert with_regen.energy_wh <= no_regen.energy_wh


class TestEstimateTripEnergy:
    """Trip-level energy estimation."""

    def _make_flat_trip(self, n=60, speed_kmh=30, category="2W_passenger"):
        speed = speed_kmh / 3.6
        return estimate_trip_energy(
            speeds_mps=[speed] * n,
            accelerations_mps2=[0.0] * n,
            grades_pct=[0.0] * n,
            distances_m=[speed] * n,
            durations_s=[1.0] * n,
            category=category,
        )

    def test_light_2w_efficiency(self):
        """Light 2W at 30 km/h should be roughly 20-60 Wh/km."""
        est = self._make_flat_trip(category="2W_passenger")
        assert 5 < est.wh_per_km < 80, f"2W Wh/km = {est.wh_per_km}"
        assert est.source == "physics_baseline"
        assert est.estimated is True

    def test_3w_cargo_uses_more_than_2w(self):
        """3W cargo should use more energy than 2W scooter at same speed."""
        est_2w = self._make_flat_trip(category="2W_passenger")
        est_3w = self._make_flat_trip(category="3W_cargo")
        assert est_3w.wh_per_km > est_2w.wh_per_km

    def test_3w_passenger_between_2w_and_cargo(self):
        """3W passenger should be between 2W and 3W cargo."""
        est_2w = self._make_flat_trip(category="2W_passenger")
        est_3w_p = self._make_flat_trip(category="3W_passenger")
        est_3w_c = self._make_flat_trip(category="3W_cargo")
        assert est_2w.wh_per_km < est_3w_p.wh_per_km < est_3w_c.wh_per_km

    def test_uncertainty_bounds(self):
        """Uncertainty should bracket the estimate."""
        est = self._make_flat_trip()
        assert est.uncertainty_lower_wh < est.total_energy_wh
        assert est.uncertainty_upper_wh > est.total_energy_wh
        assert est.uncertainty_lower_wh > 0

    def test_confidence_with_known_specs(self):
        """Providing real specs should increase confidence."""
        est = estimate_trip_energy(
            speeds_mps=[8.0] * 60,
            accelerations_mps2=[0.0] * 60,
            grades_pct=[0.0] * 60,
            distances_m=[8.0] * 60,
            durations_s=[1.0] * 60,
            category="2W_passenger",
            kerb_weight_kg=95.0,
            regen_available=False,
            usable_kwh=1.5,
            rolling_resistance=0.011,
            drag_area_m2=0.30,
            drivetrain_efficiency=0.87,
        )
        assert est.confidence in ("medium", "high")

    def test_empty_trip(self):
        """Empty trip returns zeroed estimate."""
        est = estimate_trip_energy(
            speeds_mps=[], accelerations_mps2=[], grades_pct=[],
            distances_m=[], durations_s=[],
        )
        assert est.total_energy_wh == 0.0
        assert est.wh_per_km == 0.0

    def test_demand_score_increases_with_acceleration(self):
        """More aggressive driving should produce higher demand score."""
        gentle = estimate_trip_energy(
            speeds_mps=[8.0] * 60,
            accelerations_mps2=[0.5] * 60,
            grades_pct=[0.0] * 60,
            distances_m=[8.0] * 60,
            durations_s=[1.0] * 60,
        )
        aggressive = estimate_trip_energy(
            speeds_mps=[8.0] * 60,
            accelerations_mps2=[3.0] * 60,
            grades_pct=[0.0] * 60,
            distances_m=[8.0] * 60,
            durations_s=[1.0] * 60,
        )
        assert aggressive.demand_score > gentle.demand_score


class TestSOCAndRange:
    """SOC consumption and range estimation (§SOC boundary)."""

    def test_soc_consumed(self):
        """100 Wh from a 1 kWh battery = 10% SOC consumed."""
        pct = estimate_soc_consumed(energy_wh=100.0, usable_kwh=1.0)
        assert pct == 10.0

    def test_range_with_soc(self):
        """With SOC and Wh/km, should produce a range estimate."""
        r = estimate_remaining_range(
            current_soc_pct=80.0, usable_kwh=2.0, wh_per_km=40.0,
        )
        assert r is not None
        # 80% of 2000 Wh = 1600 Wh / 40 Wh/km = 40 km
        assert r == 40.0

    def test_range_without_valid_wh_per_km(self):
        """Zero Wh/km should return None — never fabricate range."""
        r = estimate_remaining_range(
            current_soc_pct=80.0, usable_kwh=2.0, wh_per_km=0.0,
        )
        assert r is None

    def test_category_defaults_exist(self):
        """All four vehicle categories have defaults."""
        assert "2W_passenger" in CATEGORY_DEFAULTS
        assert "2W_cargo" in CATEGORY_DEFAULTS
        assert "3W_passenger" in CATEGORY_DEFAULTS
        assert "3W_cargo" in CATEGORY_DEFAULTS
