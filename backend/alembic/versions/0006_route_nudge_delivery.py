"""Add durable route-nudge delivery and handset outcome records.

Revision ID: 0006_route_nudge_delivery
Revises: 0005_trip_energy_labels
Create Date: 2026-09-08
"""
from alembic import op
import sqlalchemy as sa


revision = "0006_route_nudge_delivery"
down_revision = "0005_trip_energy_labels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daily_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("driver_id", sa.String(36), nullable=False),
        sa.Column("vehicle_id", sa.String(36), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("starting_soc_pct", sa.Float(), nullable=False),
        sa.Column("source_message", sa.Text(), nullable=False),
        sa.Column("parser_source", sa.String(50), nullable=False),
        sa.Column("draft_payload", sa.JSON(), nullable=False),
        sa.Column("result_payload", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("confirmation_key", sa.String(255), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"]),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"]),
        sa.UniqueConstraint("confirmation_key"),
    )
    for column in ("user_id", "driver_id", "vehicle_id", "service_date", "status", "confirmation_key", "created_at"):
        op.create_index(f"ix_daily_plans_{column}", "daily_plans", [column])

    op.create_table(
        "notification_outbox",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("driver_id", sa.String(36), nullable=False),
        sa.Column("vehicle_id", sa.String(36), nullable=True),
        sa.Column("planned_trip_id", sa.String(36), nullable=True),
        sa.Column("route_decision_id", sa.String(36), nullable=True),
        sa.Column("nudge_type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("failed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_code", sa.String(80), nullable=True),
        sa.Column("last_error_detail", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"]),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"]),
        sa.UniqueConstraint("idempotency_key"),
    )
    for column in (
        "idempotency_key",
        "user_id",
        "driver_id",
        "vehicle_id",
        "planned_trip_id",
        "route_decision_id",
        "nudge_type",
        "status",
        "due_at",
        "created_at",
    ):
        op.create_index(f"ix_notification_outbox_{column}", "notification_outbox", [column])

    op.create_table(
        "nudge_outcomes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("notification_outbox_id", sa.String(36), nullable=False),
        sa.Column("driver_id", sa.String(36), nullable=False),
        sa.Column("latest_event", sa.String(20), nullable=False),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.Column("opened_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(), nullable=True),
        sa.Column("followed_at", sa.DateTime(), nullable=True),
        sa.Column("selected_route_id", sa.String(160), nullable=True),
        sa.Column("selected_charger_id", sa.String(255), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["notification_outbox_id"], ["notification_outbox.id"]),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"]),
        sa.UniqueConstraint("notification_outbox_id"),
    )
    op.create_index("ix_nudge_outcomes_notification_outbox_id", "nudge_outcomes", ["notification_outbox_id"])
    op.create_index("ix_nudge_outcomes_driver_id", "nudge_outcomes", ["driver_id"])


def downgrade() -> None:
    op.drop_index("ix_nudge_outcomes_driver_id", table_name="nudge_outcomes")
    op.drop_index("ix_nudge_outcomes_notification_outbox_id", table_name="nudge_outcomes")
    op.drop_table("nudge_outcomes")
    for column in reversed((
        "idempotency_key",
        "user_id",
        "driver_id",
        "vehicle_id",
        "planned_trip_id",
        "route_decision_id",
        "nudge_type",
        "status",
        "due_at",
        "created_at",
    )):
        op.drop_index(f"ix_notification_outbox_{column}", table_name="notification_outbox")
    op.drop_table("notification_outbox")
    for column in reversed(("user_id", "driver_id", "vehicle_id", "service_date", "status", "confirmation_key", "created_at")):
        op.drop_index(f"ix_daily_plans_{column}", table_name="daily_plans")
    op.drop_table("daily_plans")
