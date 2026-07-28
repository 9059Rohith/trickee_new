"""GPS-first initial schema

Revision ID: 0001_gps_first
Revises:
Create Date: 2026-07-25

Creates the GPS-first parallel path tables and TripPrediction uncertainty columns.
Works on SQLite (dev) and PostgreSQL (prod).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_gps_first"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fleets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("city", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "drivers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("fleet_id", sa.String(36), sa.ForeignKey("fleets.id"), nullable=False),
        sa.Column("driver_code", sa.String(50), nullable=False, unique=True),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(20)),
        sa.Column("style_label", sa.String(50)),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255)),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("fleet_id", sa.String(36), sa.ForeignKey("fleets.id")),
        sa.Column("driver_id", sa.String(36), sa.ForeignKey("drivers.id")),
        sa.Column("is_active", sa.Boolean()),
        sa.Column("created_at", sa.DateTime()),
    )
    op.create_table(
        "vehicles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("fleet_id", sa.String(36), sa.ForeignKey("fleets.id"), nullable=False),
        sa.Column("vehicle_code", sa.String(50), nullable=False, unique=True),
        sa.Column("make", sa.String(100), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("battery_capacity_kwh", sa.Float(), nullable=False),
        sa.Column("max_range_km", sa.Float(), nullable=False),
        sa.Column("battery_chemistry", sa.String(20), nullable=False),
        sa.Column("manufacture_year", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean()),
        sa.Column("category", sa.String(50)),
        sa.Column("variant", sa.String(100)),
        sa.Column("usable_kwh", sa.Float()),
        sa.Column("rated_ah", sa.Float()),
        sa.Column("nominal_voltage", sa.Float()),
        sa.Column("motor_kw", sa.Float()),
        sa.Column("kerb_weight", sa.Float()),
        sa.Column("gvw", sa.Float()),
        sa.Column("payload_capacity", sa.Float()),
        sa.Column("top_speed", sa.Float()),
        sa.Column("regen_available", sa.Boolean()),
        sa.Column("certified_range", sa.Float()),
        sa.Column("spec_incomplete", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "alerts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("driver_id", sa.String(36), sa.ForeignKey("drivers.id")),
        sa.Column("alert_type", sa.String(50), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("soc_at_alert", sa.Float()),
        sa.Column("is_resolved", sa.Boolean()),
        sa.Column("created_at", sa.DateTime()),
    )
    op.create_table(
        "mobile_trip_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("driver_id", sa.String(36), sa.ForeignKey("drivers.id"), nullable=False),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id")),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime()),
        sa.Column("origin_lat", sa.Float()),
        sa.Column("origin_lng", sa.Float()),
        sa.Column("destination_text", sa.String(255)),
        sa.Column("destination_lat", sa.Float()),
        sa.Column("destination_lng", sa.Float()),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("idempotency_key", sa.String(80), unique=True),
        sa.Column("context", sa.JSON()),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "gps_raw_samples",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id")),
        sa.Column("client_batch_id", sa.String(80)),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("received_at", sa.DateTime()),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("altitude", sa.Float()),
        sa.Column("accuracy", sa.Float()),
        sa.Column("speed", sa.Float()),
        sa.Column("heading", sa.Float()),
        sa.Column("provider", sa.String(50)),
        sa.Column("mock_location_flag", sa.Boolean(), nullable=False),
        sa.Column("app_version", sa.String(50)),
        sa.Column("device_model", sa.String(100)),
        sa.Column("quality", sa.String(20), nullable=False),
        sa.Column("rejection_reason", sa.String(255)),
    )
    op.create_table(
        "gps_validated_samples",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("raw_sample_id", sa.String(36), sa.ForeignKey("gps_raw_samples.id"), nullable=False),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id")),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("altitude", sa.Float()),
        sa.Column("speed_mps", sa.Float()),
        sa.Column("heading_deg", sa.Float()),
        sa.Column("distance_delta_m", sa.Float()),
        sa.Column("time_delta_s", sa.Float()),
        sa.Column("acceleration_mps2", sa.Float()),
        sa.Column("grade_pct", sa.Float()),
    )
    op.create_table(
        "trip_features",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=False),
        sa.Column("distance_km", sa.Float()),
        sa.Column("duration_minutes", sa.Float()),
        sa.Column("avg_speed_kmh", sa.Float()),
        sa.Column("max_speed_kmh", sa.Float()),
        sa.Column("stops_count", sa.Integer(), nullable=False),
        sa.Column("total_dwell_minutes", sa.Float()),
        sa.Column("traction_demand_proxy", sa.Float()),
        sa.Column("regen_opportunity_proxy", sa.Float()),
        sa.Column("avg_grade_pct", sa.Float()),
        sa.Column("max_grade_pct", sa.Float()),
        sa.Column("grade_profile", sa.JSON()),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_table(
        "trip_predictions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=False),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id")),
        sa.Column("wh_per_km", sa.Float()),
        sa.Column("route_energy_wh", sa.Float()),
        sa.Column("demand_score", sa.Float()),
        sa.Column("soc_consumed_pct", sa.Float()),
        sa.Column("range_km", sa.Float()),
        sa.Column("confidence", sa.String(20)),
        sa.Column("confidence_numeric", sa.Float()),
        sa.Column("ood_score", sa.Float()),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("estimated", sa.Boolean(), nullable=False),
        sa.Column("uncertainty_lower", sa.Float()),
        sa.Column("uncertainty_upper", sa.Float()),
        sa.Column("provenance", sa.JSON()),
        sa.Column("created_at", sa.DateTime()),
    )
    op.create_table(
        "soc_readings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("driver_id", sa.String(36), sa.ForeignKey("drivers.id")),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime()),
    )


def downgrade() -> None:
    op.drop_table("soc_readings")
    op.drop_table("trip_predictions")
    op.drop_table("trip_features")
    op.drop_table("gps_validated_samples")
    op.drop_table("gps_raw_samples")
    op.drop_table("mobile_trip_sessions")
    op.drop_table("alerts")
    op.drop_table("vehicles")
    op.drop_table("users")
    op.drop_table("drivers")
    op.drop_table("fleets")
