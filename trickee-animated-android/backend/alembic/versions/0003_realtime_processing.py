"""Realtime processing and trip finalization schema.

Revision ID: 0003_realtime_processing
Revises: 0002_live_telemetry_foundation
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_realtime_processing"
down_revision = "0002_live_telemetry_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("mobile_trip_sessions") as batch:
        batch.add_column(sa.Column("completion_idempotency_key", sa.String(80), nullable=True))
        batch.add_column(sa.Column("final_sequence_no", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("completion_requested_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("finalization_state", sa.String(30), nullable=False, server_default="collecting"))
        batch.create_unique_constraint("uq_mobile_trip_completion_idempotency", ["completion_idempotency_key"])
        batch.create_index("ix_mobile_trip_sessions_finalization_state", ["finalization_state"])

    op.create_table(
        "processor_idempotency",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("processor_name", sa.String(80), nullable=False),
        sa.Column("outbox_id", sa.String(36), nullable=False),
        sa.Column("processed_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("processor_name", "outbox_id", name="uq_processor_outbox"),
    )
    op.create_index("ix_processor_idempotency_processor_name", "processor_idempotency", ["processor_name"])
    op.create_index("ix_processor_idempotency_outbox_id", "processor_idempotency", ["outbox_id"])

    op.create_table(
        "vehicle_live_state_snapshots",
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), primary_key=True),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=True),
        sa.Column("state_version", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("sequence_no", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("event_time", sa.DateTime(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("freshness", sa.String(20), nullable=False, server_default="OFFLINE"),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("gps_available", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("projection_status", sa.String(30), nullable=False, server_default="SYNCING"),
        sa.Column("health_payload", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_vehicle_live_state_snapshots_trip_id", "vehicle_live_state_snapshots", ["trip_id"])
    op.create_index("ix_vehicle_live_state_snapshots_freshness", "vehicle_live_state_snapshots", ["freshness"])

    op.create_table(
        "telemetry_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("vehicle_id", sa.String(36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=False),
        sa.Column("source_sample_id", sa.String(64), nullable=False),
        sa.Column("processor_name", sa.String(80), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("processor_name", "source_sample_id", "event_type", name="uq_telemetry_event_source"),
    )
    for name in ("vehicle_id", "trip_id", "source_sample_id", "event_type", "created_at"):
        op.create_index(f"ix_telemetry_events_{name}", "telemetry_events", [name])

    op.create_table(
        "trip_finalizations",
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), primary_key=True),
        sa.Column("final_sequence_no", sa.Integer(), nullable=False),
        sa.Column("processed_sequence_no", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state", sa.String(30), nullable=False, server_default="waiting"),
        sa.Column("summary", sa.JSON(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_trip_finalizations_state", "trip_finalizations", ["state"])

    op.create_table(
        "archive_manifests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("trip_id", sa.String(36), sa.ForeignKey("mobile_trip_sessions.id"), nullable=False),
        sa.Column("object_uri", sa.String(1024), nullable=False),
        sa.Column("object_generation", sa.String(100), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("first_sequence_no", sa.Integer(), nullable=False),
        sa.Column("last_sequence_no", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("restore_status", sa.String(30), nullable=False, server_default="unverified"),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_archive_manifests_trip_id", "archive_manifests", ["trip_id"], unique=True)
    op.create_index("ix_archive_manifests_restore_status", "archive_manifests", ["restore_status"])


def downgrade() -> None:
    op.drop_table("archive_manifests")
    op.drop_table("trip_finalizations")
    op.drop_table("telemetry_events")
    op.drop_table("vehicle_live_state_snapshots")
    op.drop_table("processor_idempotency")
    with op.batch_alter_table("mobile_trip_sessions") as batch:
        batch.drop_index("ix_mobile_trip_sessions_finalization_state")
        batch.drop_constraint("uq_mobile_trip_completion_idempotency", type_="unique")
        batch.drop_column("finalization_state")
        batch.drop_column("completion_requested_at")
        batch.drop_column("final_sequence_no")
        batch.drop_column("completion_idempotency_key")
