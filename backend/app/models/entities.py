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

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
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


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    fleet_id: Mapped[str] = mapped_column(String(36), ForeignKey("fleets.id"), nullable=False, index=True)
    vehicle_id: Mapped[str] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=False, index=True)
    registered_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    installation_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    device_model: Mapped[str] = mapped_column(String(100), nullable=False)
    app_version: Mapped[str] = mapped_column(String(50), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DeviceRefreshToken(Base):
    __tablename__ = "device_refresh_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    device_id: Mapped[str] = mapped_column(String(36), ForeignKey("devices.id"), nullable=False, index=True)
    family_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replaced_by_token_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


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
    completion_idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True)
    final_sequence_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finalization_state: Mapped[str] = mapped_column(String(30), nullable=False, default="collecting", index=True)
    context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# Durable live GPS/IMU ingestion
# ---------------------------------------------------------------------------

class TelemetryReceipt(Base):
    __tablename__ = "telemetry_receipts"
    __table_args__ = (
        UniqueConstraint(
            "device_id", "trip_id", "sequence_no",
            name="uq_telemetry_receipt_device_trip_sequence",
        ),
    )
    sample_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(36), ForeignKey("devices.id"), nullable=False, index=True)
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=False, index=True)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    batch_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    first_received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class TelemetryWindow(Base):
    __tablename__ = "telemetry_windows"
    sample_id: Mapped[str] = mapped_column(String(64), ForeignKey("telemetry_receipts.sample_id"), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(36), ForeignKey("devices.id"), nullable=False, index=True)
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=False, index=True)
    vehicle_id: Mapped[str] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=False, index=True)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    boot_id: Mapped[str] = mapped_column(String(64), nullable=False)
    event_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    monotonic_time_ns: Mapped[int] = mapped_column(BigInteger, nullable=False)
    window_duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    gps_available: Mapped[bool] = mapped_column(Boolean, nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    imu_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    health_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class DeviceTripUploadCursor(Base):
    __tablename__ = "device_trip_upload_cursors"
    __table_args__ = (
        UniqueConstraint("device_id", "trip_id", name="uq_device_trip_upload_cursor"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    device_id: Mapped[str] = mapped_column(String(36), ForeignKey("devices.id"), nullable=False, index=True)
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=False, index=True)
    highest_contiguous_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    highest_received_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TelemetryRejection(Base):
    __tablename__ = "telemetry_rejections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    device_id: Mapped[str] = mapped_column(String(36), ForeignKey("devices.id"), nullable=False, index=True)
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=False, index=True)
    sample_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    batch_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    message: Mapped[str] = mapped_column(String(255), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class ServerOutbox(Base):
    __tablename__ = "server_outbox"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    aggregate_type: Mapped[str] = mapped_column(String(50), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ProcessorIdempotency(Base):
    __tablename__ = "processor_idempotency"
    __table_args__ = (UniqueConstraint("processor_name", "outbox_id", name="uq_processor_outbox"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    processor_name: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    outbox_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    processed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class VehicleLiveStateSnapshot(Base):
    __tablename__ = "vehicle_live_state_snapshots"
    vehicle_id: Mapped[str] = mapped_column(String(36), ForeignKey("vehicles.id"), primary_key=True)
    trip_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=True, index=True)
    state_version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    event_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    freshness: Mapped[str] = mapped_column(String(20), nullable=False, default="OFFLINE", index=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    projection_status: Mapped[str] = mapped_column(String(30), nullable=False, default="SYNCING")
    health_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TelemetryEvent(Base):
    __tablename__ = "telemetry_events"
    __table_args__ = (UniqueConstraint("processor_name", "source_sample_id", "event_type", name="uq_telemetry_event_source"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    vehicle_id: Mapped[str] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=False, index=True)
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=False, index=True)
    source_sample_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    processor_name: Mapped[str] = mapped_column(String(80), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class TripFinalization(Base):
    __tablename__ = "trip_finalizations"
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), primary_key=True)
    final_sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    processed_sequence_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    state: Mapped[str] = mapped_column(String(30), nullable=False, default="waiting", index=True)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ArchiveManifest(Base):
    __tablename__ = "archive_manifests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), nullable=False, unique=True, index=True)
    object_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    object_generation: Mapped[str] = mapped_column(String(100), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    first_sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    last_sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    restore_status: Mapped[str] = mapped_column(String(30), nullable=False, default="unverified", index=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


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
