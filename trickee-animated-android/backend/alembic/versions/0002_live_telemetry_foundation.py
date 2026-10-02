"""Live telemetry authentication foundation.

Revision ID: 0002_live_telemetry_foundation
Revises: 0001_gps_first
Create Date: 2026-08-05
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_live_telemetry_foundation"
down_revision = "0001_gps_first"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_sub", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("google_hd", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("last_google_login_at", sa.DateTime(), nullable=True))
    op.create_index("ix_users_google_sub", "users", ["google_sub"], unique=True)

    op.create_table(
        "user_refresh_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("family_id", sa.String(36), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("replaced_by_token_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_user_refresh_tokens_user_id", "user_refresh_tokens", ["user_id"])
    op.create_index("ix_user_refresh_tokens_family_id", "user_refresh_tokens", ["family_id"])
    op.create_index("ix_user_refresh_tokens_token_hash", "user_refresh_tokens", ["token_hash"], unique=True)
    op.create_index("ix_user_refresh_tokens_expires_at", "user_refresh_tokens", ["expires_at"])
    op.create_index("ix_user_refresh_tokens_created_at", "user_refresh_tokens", ["created_at"])

    op.create_table(
        "devices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("fleet_id", sa.String(36), sa.ForeignKey("fleets.id"), nullable=False),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("registered_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("installation_id", sa.String(255), nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("device_model", sa.String(100), nullable=False),
        sa.Column("app_version", sa.String(50), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_devices_fleet_id", "devices", ["fleet_id"])
    op.create_index("ix_devices_vehicle_id", "devices", ["vehicle_id"])
    op.create_index("ix_devices_registered_by_user_id", "devices", ["registered_by_user_id"])
    op.create_index("ix_devices_installation_id", "devices", ["installation_id"], unique=True)
    op.create_index("ix_devices_is_active", "devices", ["is_active"])
    op.create_index("ix_devices_created_at", "devices", ["created_at"])

    op.create_table(
        "device_refresh_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), nullable=False),
        sa.Column("family_id", sa.String(36), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("replaced_by_token_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_device_refresh_tokens_device_id", "device_refresh_tokens", ["device_id"])
    op.create_index("ix_device_refresh_tokens_family_id", "device_refresh_tokens", ["family_id"])
    op.create_index("ix_device_refresh_tokens_token_hash", "device_refresh_tokens", ["token_hash"], unique=True)
    op.create_index("ix_device_refresh_tokens_expires_at", "device_refresh_tokens", ["expires_at"])
    op.create_index("ix_device_refresh_tokens_created_at", "device_refresh_tokens", ["created_at"])

    op.create_table(
        "telemetry_receipts",
        sa.Column("sample_id", sa.String(64), primary_key=True),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), nullable=False),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=False),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.String(80), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("first_received_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "device_id", "trip_id", "sequence_no",
            name="uq_telemetry_receipt_device_trip_sequence",
        ),
    )
    op.create_index("ix_telemetry_receipts_device_id", "telemetry_receipts", ["device_id"])
    op.create_index("ix_telemetry_receipts_trip_id", "telemetry_receipts", ["trip_id"])
    op.create_index("ix_telemetry_receipts_sequence_no", "telemetry_receipts", ["sequence_no"])
    op.create_index("ix_telemetry_receipts_batch_id", "telemetry_receipts", ["batch_id"])
    op.create_index("ix_telemetry_receipts_first_received_at", "telemetry_receipts", ["first_received_at"])

    op.create_table(
        "telemetry_windows",
        sa.Column("sample_id", sa.String(64), sa.ForeignKey("telemetry_receipts.sample_id"), primary_key=True),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), nullable=False),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=False),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
        sa.Column("boot_id", sa.String(64), nullable=False),
        sa.Column("event_time", sa.DateTime(), nullable=False),
        sa.Column("monotonic_time_ns", sa.BigInteger(), nullable=False),
        sa.Column("window_duration_ms", sa.Integer(), nullable=False),
        sa.Column("gps_available", sa.Boolean(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("gps_payload", sa.JSON(), nullable=True),
        sa.Column("imu_payload", sa.JSON(), nullable=False),
        sa.Column("health_payload", sa.JSON(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_telemetry_windows_device_id", "telemetry_windows", ["device_id"])
    op.create_index("ix_telemetry_windows_trip_id", "telemetry_windows", ["trip_id"])
    op.create_index("ix_telemetry_windows_vehicle_id", "telemetry_windows", ["vehicle_id"])
    op.create_index("ix_telemetry_windows_sequence_no", "telemetry_windows", ["sequence_no"])
    op.create_index("ix_telemetry_windows_event_time", "telemetry_windows", ["event_time"])
    op.create_index("ix_telemetry_windows_received_at", "telemetry_windows", ["received_at"])

    op.create_table(
        "device_trip_upload_cursors",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), nullable=False),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=False),
        sa.Column("highest_contiguous_sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("highest_received_sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("device_id", "trip_id", name="uq_device_trip_upload_cursor"),
    )
    op.create_index("ix_device_trip_upload_cursors_device_id", "device_trip_upload_cursors", ["device_id"])
    op.create_index("ix_device_trip_upload_cursors_trip_id", "device_trip_upload_cursors", ["trip_id"])

    op.create_table(
        "telemetry_rejections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), nullable=False),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=False),
        sa.Column("sample_id", sa.String(64), nullable=False),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.String(80), nullable=False),
        sa.Column("code", sa.String(80), nullable=False),
        sa.Column("message", sa.String(255), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_telemetry_rejections_device_id", "telemetry_rejections", ["device_id"])
    op.create_index("ix_telemetry_rejections_trip_id", "telemetry_rejections", ["trip_id"])
    op.create_index("ix_telemetry_rejections_sample_id", "telemetry_rejections", ["sample_id"])
    op.create_index("ix_telemetry_rejections_sequence_no", "telemetry_rejections", ["sequence_no"])
    op.create_index("ix_telemetry_rejections_batch_id", "telemetry_rejections", ["batch_id"])
    op.create_index("ix_telemetry_rejections_received_at", "telemetry_rejections", ["received_at"])

    op.create_table(
        "server_outbox",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("aggregate_type", sa.String(50), nullable=False),
        sa.Column("aggregate_id", sa.String(80), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_server_outbox_event_type", "server_outbox", ["event_type"])
    op.create_index("ix_server_outbox_aggregate_id", "server_outbox", ["aggregate_id"])
    op.create_index("ix_server_outbox_state", "server_outbox", ["state"])
    op.create_index("ix_server_outbox_created_at", "server_outbox", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_server_outbox_created_at", table_name="server_outbox")
    op.drop_index("ix_server_outbox_state", table_name="server_outbox")
    op.drop_index("ix_server_outbox_aggregate_id", table_name="server_outbox")
    op.drop_index("ix_server_outbox_event_type", table_name="server_outbox")
    op.drop_table("server_outbox")
    op.drop_index("ix_telemetry_rejections_received_at", table_name="telemetry_rejections")
    op.drop_index("ix_telemetry_rejections_batch_id", table_name="telemetry_rejections")
    op.drop_index("ix_telemetry_rejections_sequence_no", table_name="telemetry_rejections")
    op.drop_index("ix_telemetry_rejections_sample_id", table_name="telemetry_rejections")
    op.drop_index("ix_telemetry_rejections_trip_id", table_name="telemetry_rejections")
    op.drop_index("ix_telemetry_rejections_device_id", table_name="telemetry_rejections")
    op.drop_table("telemetry_rejections")
    op.drop_index("ix_device_trip_upload_cursors_trip_id", table_name="device_trip_upload_cursors")
    op.drop_index("ix_device_trip_upload_cursors_device_id", table_name="device_trip_upload_cursors")
    op.drop_table("device_trip_upload_cursors")
    op.drop_index("ix_telemetry_windows_received_at", table_name="telemetry_windows")
    op.drop_index("ix_telemetry_windows_event_time", table_name="telemetry_windows")
    op.drop_index("ix_telemetry_windows_sequence_no", table_name="telemetry_windows")
    op.drop_index("ix_telemetry_windows_vehicle_id", table_name="telemetry_windows")
    op.drop_index("ix_telemetry_windows_trip_id", table_name="telemetry_windows")
    op.drop_index("ix_telemetry_windows_device_id", table_name="telemetry_windows")
    op.drop_table("telemetry_windows")
    op.drop_index("ix_telemetry_receipts_first_received_at", table_name="telemetry_receipts")
    op.drop_index("ix_telemetry_receipts_batch_id", table_name="telemetry_receipts")
    op.drop_index("ix_telemetry_receipts_sequence_no", table_name="telemetry_receipts")
    op.drop_index("ix_telemetry_receipts_trip_id", table_name="telemetry_receipts")
    op.drop_index("ix_telemetry_receipts_device_id", table_name="telemetry_receipts")
    op.drop_table("telemetry_receipts")
    op.drop_index("ix_device_refresh_tokens_created_at", table_name="device_refresh_tokens")
    op.drop_index("ix_device_refresh_tokens_expires_at", table_name="device_refresh_tokens")
    op.drop_index("ix_device_refresh_tokens_token_hash", table_name="device_refresh_tokens")
    op.drop_index("ix_device_refresh_tokens_family_id", table_name="device_refresh_tokens")
    op.drop_index("ix_device_refresh_tokens_device_id", table_name="device_refresh_tokens")
    op.drop_table("device_refresh_tokens")
    op.drop_index("ix_devices_created_at", table_name="devices")
    op.drop_index("ix_devices_is_active", table_name="devices")
    op.drop_index("ix_devices_installation_id", table_name="devices")
    op.drop_index("ix_devices_registered_by_user_id", table_name="devices")
    op.drop_index("ix_devices_vehicle_id", table_name="devices")
    op.drop_index("ix_devices_fleet_id", table_name="devices")
    op.drop_table("devices")
    op.drop_index("ix_user_refresh_tokens_created_at", table_name="user_refresh_tokens")
    op.drop_index("ix_user_refresh_tokens_expires_at", table_name="user_refresh_tokens")
    op.drop_index("ix_user_refresh_tokens_token_hash", table_name="user_refresh_tokens")
    op.drop_index("ix_user_refresh_tokens_family_id", table_name="user_refresh_tokens")
    op.drop_index("ix_user_refresh_tokens_user_id", table_name="user_refresh_tokens")
    op.drop_table("user_refresh_tokens")
    op.drop_index("ix_users_google_sub", table_name="users")
    op.drop_column("users", "last_google_login_at")
    op.drop_column("users", "google_hd")
    op.drop_column("users", "google_sub")
