"""Add plan-aware trip, recurrence, and route-guidance persistence.

Revision ID: 0009_plan_aware_guidance
Revises: 0008_live_nudge_evaluations
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa


revision = "0009_plan_aware_guidance"
down_revision = "0008_live_nudge_evaluations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recurring_plan_templates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("driver_id", sa.String(36), nullable=False),
        sa.Column("vehicle_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("weekdays", sa.JSON(), nullable=False),
        sa.Column("starting_soc_pct", sa.Float(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_until", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"]),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"]),
    )
    for column in ("user_id", "driver_id", "vehicle_id", "is_active"):
        op.create_index(f"ix_recurring_plan_templates_{column}", "recurring_plan_templates", [column])

    op.create_table(
        "recurring_plan_stops",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("template_id", sa.String(36), nullable=False),
        sa.Column("stop_index", sa.Integer(), nullable=False),
        sa.Column("destination_text", sa.String(255), nullable=False),
        sa.Column("destination_lat", sa.Float(), nullable=False),
        sa.Column("destination_lng", sa.Float(), nullable=False),
        sa.Column("arrival_local_time", sa.String(5), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["template_id"], ["recurring_plan_templates.id"]),
        sa.UniqueConstraint("template_id", "stop_index", name="uq_recurring_plan_stop_index"),
    )
    op.create_index("ix_recurring_plan_stops_template_id", "recurring_plan_stops", ["template_id"])

    with op.batch_alter_table("daily_plans") as batch:
        batch.add_column(sa.Column("recurring_template_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_daily_plans_recurring_template_id",
            "recurring_plan_templates",
            ["recurring_template_id"],
            ["id"],
        )
        batch.create_unique_constraint(
            "uq_daily_plan_template_service_date",
            ["recurring_template_id", "service_date"],
        )
    op.create_index("ix_daily_plans_recurring_template_id", "daily_plans", ["recurring_template_id"])

    op.create_table(
        "daily_plan_legs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("plan_id", sa.String(36), nullable=False),
        sa.Column("leg_index", sa.Integer(), nullable=False),
        sa.Column("destination_text", sa.String(255), nullable=False),
        sa.Column("destination_lat", sa.Float(), nullable=False),
        sa.Column("destination_lng", sa.Float(), nullable=False),
        sa.Column("planned_departure_at", sa.DateTime(), nullable=True),
        sa.Column("planned_arrival_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("trip_id", sa.String(36), nullable=True),
        sa.Column("outcome_reason", sa.String(255), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["daily_plans.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["mobile_trip_sessions.id"]),
        sa.UniqueConstraint("plan_id", "leg_index", name="uq_daily_plan_leg_index"),
        sa.UniqueConstraint("trip_id", name="uq_daily_plan_legs_trip_id"),
    )
    for column in ("plan_id", "planned_departure_at", "status", "trip_id"):
        op.create_index(f"ix_daily_plan_legs_{column}", "daily_plan_legs", [column])

    with op.batch_alter_table("mobile_trip_sessions") as batch:
        batch.add_column(sa.Column("planned_trip_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("planned_leg_index", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("destination_source", sa.String(30), nullable=True))
        batch.add_column(sa.Column("ended_lat", sa.Float(), nullable=True))
        batch.add_column(sa.Column("ended_lng", sa.Float(), nullable=True))
    op.create_index("ix_mobile_trip_sessions_planned_trip_id", "mobile_trip_sessions", ["planned_trip_id"])

    op.create_table(
        "route_guidance_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("trip_id", sa.String(36), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("route_id", sa.String(160), nullable=True),
        sa.Column("origin_lat", sa.Float(), nullable=False),
        sa.Column("origin_lng", sa.Float(), nullable=False),
        sa.Column("destination_lat", sa.Float(), nullable=False),
        sa.Column("destination_lng", sa.Float(), nullable=False),
        sa.Column("distance_km", sa.Float(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("eta_at", sa.DateTime(), nullable=True),
        sa.Column("predicted_arrival_soc_pct", sa.Float(), nullable=True),
        sa.Column("reserve_soc_pct", sa.Float(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("is_estimated", sa.Boolean(), nullable=False),
        sa.Column("stale_after", sa.DateTime(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["mobile_trip_sessions.id"]),
    )
    for column in ("trip_id", "stale_after", "created_at"):
        op.create_index(f"ix_route_guidance_snapshots_{column}", "route_guidance_snapshots", [column])


def downgrade() -> None:
    for column in reversed(("trip_id", "stale_after", "created_at")):
        op.drop_index(f"ix_route_guidance_snapshots_{column}", table_name="route_guidance_snapshots")
    op.drop_table("route_guidance_snapshots")
    op.drop_index("ix_mobile_trip_sessions_planned_trip_id", table_name="mobile_trip_sessions")
    with op.batch_alter_table("mobile_trip_sessions") as batch:
        for column in ("ended_lng", "ended_lat", "destination_source", "planned_leg_index", "planned_trip_id"):
            batch.drop_column(column)
    for column in reversed(("plan_id", "planned_departure_at", "status", "trip_id")):
        op.drop_index(f"ix_daily_plan_legs_{column}", table_name="daily_plan_legs")
    op.drop_table("daily_plan_legs")
    op.drop_index("ix_daily_plans_recurring_template_id", table_name="daily_plans")
    with op.batch_alter_table("daily_plans") as batch:
        batch.drop_constraint("uq_daily_plan_template_service_date", type_="unique")
        batch.drop_constraint("fk_daily_plans_recurring_template_id", type_="foreignkey")
        batch.drop_column("recurring_template_id")
    op.drop_index("ix_recurring_plan_stops_template_id", table_name="recurring_plan_stops")
    op.drop_table("recurring_plan_stops")
    for column in reversed(("user_id", "driver_id", "vehicle_id", "is_active")):
        op.drop_index(f"ix_recurring_plan_templates_{column}", table_name="recurring_plan_templates")
    op.drop_table("recurring_plan_templates")
