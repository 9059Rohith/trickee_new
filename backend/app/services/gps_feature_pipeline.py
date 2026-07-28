"""
GPS feature pipeline — shared by training AND inference (§6.3).

Deterministic filtering, quality gating, movement feature extraction.
Uses GPS-safe proxy names throughout.
"""
from __future__ import annotations

from app.models.entities import GPSRawSample, GPSValidatedSample, TripFeature
from app.services.physics_gps import (
    haversine_distance,
    calculate_speed_mps,
    calculate_acceleration_mps2,
    calculate_grade_pct,
)

# Quality gate thresholds (§9.1)
ACCURACY_THRESHOLD_M = 50.0
MAX_SPEED_MPS = 45.0        # ~162 km/h — impossible for 2W/3W
MAX_ACCELERATION_MPS2 = 8.0  # extreme for EVs
MAX_ALTITUDE_CHANGE_M = 50.0 # per sample interval


def process_trip_gps_samples(
    trip_id: str,
    raw_samples: list[GPSRawSample],
) -> tuple[list[GPSValidatedSample], TripFeature]:
    """
    Process raw GPS samples for a trip:
    1. Filter poor-accuracy / impossible points (mark, don't drop)
    2. Calculate derived movement features per pair
    3. Extract trip-level aggregate features

    Returns (validated_samples, trip_feature).
    """
    sorted_samples = sorted(raw_samples, key=lambda s: s.timestamp)
    validated: list[GPSValidatedSample] = []

    total_dist_m = 0.0
    total_dur_s = 0.0
    stops = 0
    dwell_s = 0.0
    max_speed = 0.0
    traction_demand = 0.0
    regen_opportunity = 0.0
    grade_values: list[float] = []
    is_stopped = False

    for i, raw in enumerate(sorted_samples):
        # Quality gate: accuracy
        if raw.accuracy is not None and raw.accuracy > ACCURACY_THRESHOLD_M:
            raw.quality = "rejected"
            raw.rejection_reason = "poor_accuracy"
            continue

        # Quality gate: mock location
        if raw.mock_location_flag:
            raw.quality = "rejected"
            raw.rejection_reason = "mock_location"
            continue

        v = GPSValidatedSample(
            raw_sample_id=raw.id,
            trip_id=trip_id,
            timestamp=raw.timestamp,
            lat=raw.lat,
            lng=raw.lng,
            altitude=raw.altitude,
            heading_deg=raw.heading,
        )

        if not validated:
            v.distance_delta_m = 0.0
            v.time_delta_s = 0.0
            v.speed_mps = raw.speed if raw.speed is not None else 0.0
            v.acceleration_mps2 = 0.0
            v.grade_pct = 0.0
        else:
            prev = validated[-1]
            dt = (v.timestamp - prev.timestamp).total_seconds()
            v.time_delta_s = dt
            total_dur_s += dt

            dist = haversine_distance(prev.lat, prev.lng, v.lat, v.lng)

            # Quality gate: teleportation
            if dt > 0 and dist / dt > MAX_SPEED_MPS * 2:
                raw.quality = "rejected"
                raw.rejection_reason = "teleportation"
                continue

            v.distance_delta_m = dist
            total_dist_m += dist

            # Speed — prefer device-reported, fallback to calculated
            if raw.speed is not None and raw.speed >= 0:
                v.speed_mps = raw.speed
            else:
                v.speed_mps = calculate_speed_mps(dist, dt)

            # Quality gate: impossible speed
            if v.speed_mps > MAX_SPEED_MPS:
                raw.quality = "rejected"
                raw.rejection_reason = "impossible_speed"
                continue

            max_speed = max(max_speed, v.speed_mps)

            # Acceleration
            v.acceleration_mps2 = calculate_acceleration_mps2(
                prev.speed_mps or 0.0, v.speed_mps, dt
            )
            if abs(v.acceleration_mps2) > MAX_ACCELERATION_MPS2:
                raw.quality = "rejected"
                raw.rejection_reason = "impossible_acceleration"
                continue

            # Grade
            v.grade_pct = calculate_grade_pct(prev.altitude, v.altitude, dist)

            # Quality gate: unrealistic altitude change
            if prev.altitude is not None and v.altitude is not None:
                if abs(v.altitude - prev.altitude) > MAX_ALTITUDE_CHANGE_M:
                    v.grade_pct = 0.0  # Zero out but don't reject the sample

            grade_values.append(v.grade_pct)

            # Stop detection
            if v.speed_mps < 0.5:
                if not is_stopped:
                    is_stopped = True
                    stops += 1
                dwell_s += dt
            else:
                is_stopped = False

            # Traction demand & regen opportunity proxies (GPS-safe names)
            if v.acceleration_mps2 > 0:
                traction_demand += v.acceleration_mps2 * dt
            elif v.acceleration_mps2 < 0:
                regen_opportunity += abs(v.acceleration_mps2) * dt

        raw.quality = "validated"
        validated.append(v)

    MPS_TO_KMH = 3.6
    avg_speed = (total_dist_m / total_dur_s * MPS_TO_KMH) if total_dur_s > 0 else 0.0

    feature = TripFeature(
        trip_id=trip_id,
        distance_km=round(total_dist_m / 1000.0, 3),
        duration_minutes=round(total_dur_s / 60.0, 2),
        avg_speed_kmh=round(avg_speed, 1),
        max_speed_kmh=round(max_speed * MPS_TO_KMH, 1),
        stops_count=stops,
        total_dwell_minutes=round(dwell_s / 60.0, 2),
        traction_demand_proxy=round(traction_demand, 3),
        regen_opportunity_proxy=round(regen_opportunity, 3),
        avg_grade_pct=round(sum(grade_values) / len(grade_values), 2) if grade_values else 0.0,
        max_grade_pct=round(max(grade_values, default=0.0), 2),
    )

    return validated, feature
