"""
Database entity models for Trickee GPS-First EV Intelligence.

NON-NEGOTIABLE RULES:
- No field may imply direct BMS measurement unless the value genuinely came
  from a BMS/OEM/Bluetooth source.
- GPS-derived proxies use explicit names: traction_demand_proxy,
  regen_opportunity_proxy — never "throttle" or "regenerated_energy".
- Every prediction carries: value, confidence, source, estimated flag.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Core entities (mirrored from existing V4.1 — kept intact)
# ---------------------------------------------------------------------------

class Fleet(Base):
    __tablename__ = "fleets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="fleet")
    drivers: Mapped[list["Driver"]] = relationship(back_populates="fleet")
    users: Mapped[list["User"]] = relationship(back_populates="fleet")


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="driver")
    fleet_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("fleets.id"), nullable=True)
    driver_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("drivers.id"), nullable=True)
    google_sub: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)
    google_hd: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_google_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    fleet: Mapped[Fleet | None] = relationship(back_populates="users")
    driver: Mapped["Driver | None"] = relationship(back_populates="user")


class UserRefreshToken(Base):
    __tablename__ = "user_refresh_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    family_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replaced_by_token_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Driver(Base):
    __tablename__ = "drivers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    fleet_id: Mapped[str] = mapped_column(String(36), ForeignKey("fleets.id"), nullable=False)
    driver_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    style_label: Mapped[str] = mapped_column(String(50), default="Moderate")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    fleet: Mapped[Fleet] = relationship(back_populates="drivers")
    user: Mapped[User | None] = relationship(back_populates="driver")


# ---------------------------------------------------------------------------
# Vehicle — includes GPS-first extended spec fields (§7)
# ---------------------------------------------------------------------------

class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    fleet_id: Mapped[str] = mapped_column(String(36), ForeignKey("fleets.id"), nullable=False)
    vehicle_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    make: Mapped[str] = mapped_column(String(100), nullable=False, default="Unknown")
    model: Mapped[str] = mapped_column(String(100), nullable=False, default="Unknown")
    battery_capacity_kwh: Mapped[float] = mapped_column(Float, nullable=False, default=1.824)
    max_range_km: Mapped[float] = mapped_column(Float, nullable=False, default=85.0)
    battery_chemistry: Mapped[str] = mapped_column(String(20), nullable=False, default="LFP")
    manufacture_year: Mapped[int] = mapped_column(Integer, nullable=False, default=2024)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # GPS-first minimum spec set (§7)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 2W_passenger, 2W_cargo, 3W_passenger, 3W_cargo
    variant: Mapped[str | None] = mapped_column(String(100), nullable=True)
    usable_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    rated_ah: Mapped[float | None] = mapped_column(Float, nullable=True)
    nominal_voltage: Mapped[float | None] = mapped_column(Float, nullable=True)
    motor_kw: Mapped[float | None] = mapped_column(Float, nullable=True)
    kerb_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    gvw: Mapped[float | None] = mapped_column(Float, nullable=True)
    payload_capacity: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    regen_available: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    certified_range: Mapped[float | None] = mapped_column(Float, nullable=True)
    spec_incomplete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    fleet: Mapped[Fleet] = relationship(back_populates="vehicles")


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    vehicle_id: Mapped[str] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=False, index=True)
    driver_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("drivers.id"), nullable=True, index=True)
    alert_type: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    soc_at_alert: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


# ---------------------------------------------------------------------------
# Mobile trip session
# ---------------------------------------------------------------------------

class MobileTripSession(Base):
    __tablename__ = "mobile_trip_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    driver_id: Mapped[str] = mapped_column(String(36), ForeignKey("drivers.id"), nullable=False, index=True)
    vehicle_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=True, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    origin_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    origin_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    destination_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    destination_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    destination_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active", index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="action_button")
    idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True)
    context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# GPS data pipeline tables — §6.2 storage layering
# ---------------------------------------------------------------------------

class GPSRawSample(Base):
    """
    Minimal raw GPS storage. Provenance-tagged, privacy-retention-bound.
    Never overwritten or merged with V4.1 telemetry tables.
    """
    __tablename__ = "gps_raw_samples"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=True, index=True)
    client_batch_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    altitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mock_location_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    app_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    device_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quality: Mapped[str] = mapped_column(String(20), nullable=False, default="unprocessed")
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)


class GPSValidatedSample(Base):
    """After quality filtering — derived from GPSRawSample."""
    __tablename__ = "gps_validated_samples"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    raw_sample_id: Mapped[str] = mapped_column(String(36), ForeignKey("gps_raw_samples.id"), nullable=False, index=True)
    trip_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    altitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_delta_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    time_delta_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    acceleration_mps2: Mapped[float | None] = mapped_column(Float, nullable=True)
    grade_pct: Mapped[float | None] = mapped_column(Float, nullable=True)


class TripFeature(Base):
    """
    Derived movement features per trip.
    Uses GPS-safe proxy names — never BMS field names.
    """
    __tablename__ = "trip_features"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=False, index=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    stops_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_dwell_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    traction_demand_proxy: Mapped[float | None] = mapped_column(Float, nullable=True)
    regen_opportunity_proxy: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_grade_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_grade_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    grade_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TripPrediction(Base):
    """
    GPS model outputs. Every row has value + confidence + source.
    range_km is NULL unless a recent SOC reading exists — never fabricated.
    """
    __tablename__ = "trip_predictions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=False, index=True)
    vehicle_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=True, index=True)
    wh_per_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    route_energy_wh: Mapped[float | None] = mapped_column(Float, nullable=True)
    demand_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    soc_consumed_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    range_km: Mapped[float | None] = mapped_column(Float, nullable=True)  # NULL if no SOC
    confidence: Mapped[str | None] = mapped_column(String(20), nullable=True)  # low/medium/high
    confidence_numeric: Mapped[float | None] = mapped_column(Float, nullable=True)
    ood_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="physics_baseline")
    estimated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    uncertainty_lower: Mapped[float | None] = mapped_column(Float, nullable=True)
    uncertainty_upper: Mapped[float | None] = mapped_column(Float, nullable=True)
    provenance: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class SOCReading(Base):
    """
    SOC readings from any valid source. Required for range estimation.
    source must be one of: manual, bluetooth_bms, oem_api, fleet_export, dashboard_confirmed
    """
    __tablename__ = "soc_readings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    vehicle_id: Mapped[str] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=False, index=True)
    driver_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("drivers.id"), nullable=True, index=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)  # manual|bluetooth_bms|oem_api|fleet_export|dashboard_confirmed
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
