"""
GPS-based physics utilities: haversine, speed, acceleration, grade.
Standalone module — no BMS dependencies.
"""
from __future__ import annotations

import math

R_EARTH = 6_371_000.0  # Earth radius in meters


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS-84 points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return R_EARTH * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def calculate_speed_mps(distance_m: float, time_s: float) -> float:
    """Speed in m/s; returns 0 for non-positive time."""
    return distance_m / time_s if time_s > 0 else 0.0


def calculate_acceleration_mps2(speed1: float, speed2: float, time_s: float) -> float:
    """Acceleration in m/s²."""
    return (speed2 - speed1) / time_s if time_s > 0 else 0.0


def calculate_grade_pct(alt1: float | None, alt2: float | None, distance_m: float) -> float:
    """Road grade as a percentage.  Returns 0 when altitude is missing."""
    if alt1 is None or alt2 is None or distance_m <= 0:
        return 0.0
    return ((alt2 - alt1) / distance_m) * 100.0
