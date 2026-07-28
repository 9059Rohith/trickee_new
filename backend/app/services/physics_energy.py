"""
Vehicle-aware GPS-based energy estimator — the Physics Baseline Engine (§8).

Implements the core physics model:
    rolling_force   = mass × g × Crr
    grade_force     = mass × g × sin(grade)
    aero_force      = 0.5 × ρ × CdA × v²
    accel_force     = mass × a
    traction_power  = total_force × v
    battery_power   = traction_power / η_drivetrain + P_aux

This module:
- Uses ONLY vehicle specs + GPS movement data.  Zero BMS dependency.
- Returns energy estimates WITH uncertainty intervals.
- Provides category-aware defaults for uncertain parameters.
- Is a standalone, testable cold-start fallback for unseen vehicle models.

NON-NEGOTIABLE: This module never generates fake current, voltage, SOC,
temperature, SOH, or cell-imbalance values.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Physical constants
# ---------------------------------------------------------------------------
GRAVITY = 9.81          # m/s²
AIR_DENSITY = 1.225     # kg/m³ at sea level, 15 °C


# ---------------------------------------------------------------------------
# Category-aware defaults for uncertain parameters
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class CategoryDefaults:
    """Default physics parameters per vehicle category when specs are missing."""
    rolling_resistance: float
    drag_area_m2: float           # Cd × A
    drivetrain_efficiency: float  # motor+controller+transmission
    auxiliary_power_w: float      # lights, controller, fans
    regen_efficiency: float       # fraction of braking energy recovered (0 if no regen)
    default_mass_kg: float        # kerb + assumed payload

CATEGORY_DEFAULTS: dict[str, CategoryDefaults] = {
    "2W_passenger": CategoryDefaults(
        rolling_resistance=0.012,
        drag_area_m2=0.35,
        drivetrain_efficiency=0.85,
        auxiliary_power_w=30.0,
        regen_efficiency=0.0,
        default_mass_kg=130.0,
    ),
    "2W_cargo": CategoryDefaults(
        rolling_resistance=0.014,
        drag_area_m2=0.45,
        drivetrain_efficiency=0.83,
        auxiliary_power_w=40.0,
        regen_efficiency=0.0,
        default_mass_kg=200.0,
    ),
    "3W_passenger": CategoryDefaults(
        rolling_resistance=0.015,
        drag_area_m2=0.80,
        drivetrain_efficiency=0.82,
        auxiliary_power_w=60.0,
        regen_efficiency=0.10,
        default_mass_kg=450.0,
    ),
    "3W_cargo": CategoryDefaults(
        rolling_resistance=0.018,
        drag_area_m2=0.95,
        drivetrain_efficiency=0.80,
        auxiliary_power_w=70.0,
        regen_efficiency=0.08,
        default_mass_kg=650.0,
    ),
}

DEFAULT_CATEGORY = "2W_passenger"


def _get_defaults(category: str | None) -> CategoryDefaults:
    return CATEGORY_DEFAULTS.get(category or DEFAULT_CATEGORY,
                                 CATEGORY_DEFAULTS[DEFAULT_CATEGORY])


# ---------------------------------------------------------------------------
# Per-sample energy computation
# ---------------------------------------------------------------------------

@dataclass
class SampleEnergy:
    """Energy consumed/recovered for a single GPS sample interval."""
    energy_wh: float = 0.0
    distance_m: float = 0.0
    duration_s: float = 0.0


def compute_sample_energy(
    *,
    speed_mps: float,
    acceleration_mps2: float,
    grade_pct: float,
    distance_m: float,
    duration_s: float,
    mass_kg: float,
    rolling_resistance: float,
    drag_area_m2: float,
    drivetrain_efficiency: float,
    auxiliary_power_w: float,
    regen_efficiency: float,
) -> SampleEnergy:
    """Compute battery energy (Wh) for one GPS interval using physics."""
    if duration_s <= 0 or distance_m <= 0:
        return SampleEnergy(energy_wh=0.0, distance_m=distance_m, duration_s=duration_s)

    grade_rad = math.atan(grade_pct / 100.0)

    rolling_force = mass_kg * GRAVITY * rolling_resistance * math.cos(grade_rad)
    grade_force = mass_kg * GRAVITY * math.sin(grade_rad)
    aero_force = 0.5 * AIR_DENSITY * drag_area_m2 * speed_mps ** 2
    accel_force = mass_kg * acceleration_mps2

    total_force = rolling_force + grade_force + aero_force + accel_force
    traction_power_w = total_force * speed_mps

    if traction_power_w >= 0:
        # Motoring — energy drawn from battery
        battery_power_w = traction_power_w / max(drivetrain_efficiency, 0.5) + auxiliary_power_w
    else:
        # Braking — partial energy recovery if regen is available
        battery_power_w = traction_power_w * regen_efficiency * drivetrain_efficiency + auxiliary_power_w

    energy_wh = (battery_power_w * duration_s) / 3600.0

    return SampleEnergy(energy_wh=energy_wh, distance_m=distance_m, duration_s=duration_s)


# ---------------------------------------------------------------------------
# Trip-level energy estimation with uncertainty
# ---------------------------------------------------------------------------

@dataclass
class TripEnergyEstimate:
    """Complete trip energy estimate with uncertainty."""
    total_energy_wh: float = 0.0
    total_distance_km: float = 0.0
    total_duration_min: float = 0.0
    wh_per_km: float = 0.0
    demand_score: float = 0.0  # 0-100 normalized driving demand
    uncertainty_lower_wh: float = 0.0
    uncertainty_upper_wh: float = 0.0
    confidence: str = "low"  # low / medium / high
    confidence_numeric: float = 0.0
    source: str = "physics_baseline"
    estimated: bool = True
    assumptions: dict = field(default_factory=dict)


def estimate_trip_energy(
    *,
    speeds_mps: list[float],
    accelerations_mps2: list[float],
    grades_pct: list[float],
    distances_m: list[float],
    durations_s: list[float],
    # Vehicle specs
    category: str | None = None,
    kerb_weight_kg: float | None = None,
    payload_kg: float | None = None,
    regen_available: bool | None = None,
    usable_kwh: float | None = None,
    # Overridable physics params
    rolling_resistance: float | None = None,
    drag_area_m2: float | None = None,
    drivetrain_efficiency: float | None = None,
    auxiliary_power_w: float | None = None,
) -> TripEnergyEstimate:
    """
    Estimate total trip energy from GPS-derived movement features + vehicle specs.

    Returns a TripEnergyEstimate with uncertainty bounds.
    """
    n = len(speeds_mps)
    if n == 0:
        return TripEnergyEstimate()

    defaults = _get_defaults(category)
    assumptions: dict = {}

    # Resolve mass
    if kerb_weight_kg is not None:
        mass_kg = kerb_weight_kg + (payload_kg or 0.0)
        if payload_kg is None:
            assumptions["payload"] = "assumed_zero"
    else:
        mass_kg = defaults.default_mass_kg
        assumptions["mass"] = f"category_default_{category or DEFAULT_CATEGORY}"

    # Resolve physics params — use provided or fall back to category default
    crr = rolling_resistance if rolling_resistance is not None else defaults.rolling_resistance
    cda = drag_area_m2 if drag_area_m2 is not None else defaults.drag_area_m2
    eta = drivetrain_efficiency if drivetrain_efficiency is not None else defaults.drivetrain_efficiency
    p_aux = auxiliary_power_w if auxiliary_power_w is not None else defaults.auxiliary_power_w
    regen_eff = defaults.regen_efficiency if (regen_available is True or regen_available is None) else 0.0

    if rolling_resistance is None:
        assumptions["rolling_resistance"] = "category_default"
    if drag_area_m2 is None:
        assumptions["drag_area"] = "category_default"
    if drivetrain_efficiency is None:
        assumptions["drivetrain_efficiency"] = "category_default"

    # Compute energy sample by sample
    total_energy = 0.0
    total_dist = 0.0
    total_dur = 0.0
    positive_accel_sum = 0.0
    negative_accel_sum = 0.0

    for i in range(n):
        se = compute_sample_energy(
            speed_mps=speeds_mps[i],
            acceleration_mps2=accelerations_mps2[i],
            grade_pct=grades_pct[i],
            distance_m=distances_m[i],
            duration_s=durations_s[i],
            mass_kg=mass_kg,
            rolling_resistance=crr,
            drag_area_m2=cda,
            drivetrain_efficiency=eta,
            auxiliary_power_w=p_aux,
            regen_efficiency=regen_eff,
        )
        total_energy += se.energy_wh
        total_dist += se.distance_m
        total_dur += se.duration_s

        if accelerations_mps2[i] > 0:
            positive_accel_sum += accelerations_mps2[i] * durations_s[i]
        else:
            negative_accel_sum += abs(accelerations_mps2[i]) * durations_s[i]

    total_dist_km = total_dist / 1000.0
    total_dur_min = total_dur / 60.0
    wh_per_km = total_energy / total_dist_km if total_dist_km > 0 else 0.0

    # Demand score: normalized 0-100 based on mean positive acceleration.
    # Scale factor 25 keeps typical city accel (~0.5–3 m/s²) spread across the range
    # without collapsing mild vs aggressive driving to the same ceiling.
    if total_dur > 0:
        mean_pos_accel = positive_accel_sum / total_dur
        demand_score = min(100.0, mean_pos_accel * 25.0)
    else:
        demand_score = 0.0

    # Uncertainty: ±20% for physics baseline with many assumptions
    uncertainty_pct = 0.20
    assumption_count = len(assumptions)
    if assumption_count >= 3:
        uncertainty_pct = 0.30
        confidence = "low"
        confidence_numeric = 0.3
    elif assumption_count >= 1:
        uncertainty_pct = 0.20
        confidence = "medium"
        confidence_numeric = 0.6
    else:
        uncertainty_pct = 0.12
        confidence = "high"
        confidence_numeric = 0.85

    # More data points = slightly more confident
    if n > 100:
        confidence_numeric = min(1.0, confidence_numeric + 0.05)
    if n < 10:
        confidence_numeric = max(0.1, confidence_numeric - 0.1)
        confidence = "low"

    return TripEnergyEstimate(
        total_energy_wh=round(total_energy, 2),
        total_distance_km=round(total_dist_km, 3),
        total_duration_min=round(total_dur_min, 2),
        wh_per_km=round(wh_per_km, 2),
        demand_score=round(demand_score, 1),
        uncertainty_lower_wh=round(total_energy * (1 - uncertainty_pct), 2),
        uncertainty_upper_wh=round(total_energy * (1 + uncertainty_pct), 2),
        confidence=confidence,
        confidence_numeric=round(confidence_numeric, 2),
        source="physics_baseline",
        estimated=True,
        assumptions=assumptions,
    )


def estimate_soc_consumed(
    *,
    energy_wh: float,
    usable_kwh: float,
    soh_factor: float = 1.0,
) -> float:
    """Estimate SOC percentage consumed given energy used and battery capacity."""
    usable_wh = usable_kwh * 1000.0 * soh_factor
    if usable_wh <= 0:
        return 0.0
    return round((energy_wh / usable_wh) * 100.0, 2)


def estimate_remaining_range(
    *,
    current_soc_pct: float,
    usable_kwh: float,
    wh_per_km: float,
    soh_factor: float = 1.0,
) -> float | None:
    """
    Estimate remaining range ONLY when a recent SOC exists.
    Returns None if wh_per_km is zero or invalid — never fabricates a number.
    """
    if wh_per_km <= 0 or current_soc_pct < 0:
        return None
    remaining_energy_wh = usable_kwh * 1000.0 * soh_factor * (current_soc_pct / 100.0)
    return round(remaining_energy_wh / wh_per_km, 1)
