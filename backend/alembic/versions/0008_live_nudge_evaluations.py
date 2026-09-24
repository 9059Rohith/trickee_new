"""Checkpoint active-trip guidance without calling providers from telemetry ingestion.

Revision ID: 0008_live_nudge_evaluations
Revises: 0007_fcm_device_tokens
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_live_nudge_evaluations"
down_revision = "0007_fcm_device_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_nudge_evaluations",
        sa.Column("trip_id", sa.String(length=36), sa.ForeignKey("mobile_trip_sessions.id"), primary_key=True),
        sa.Column("last_evaluated_at", sa.DateTime(), nullable=True),
        sa.Column("soc_anchor_key", sa.String(length=80), nullable=True),
        sa.Column("soc_anchor_at", sa.DateTime(), nullable=True),
        sa.Column("soc_anchor_distance_km", sa.Float(), nullable=True),
        sa.Column("soc_anchor_pct", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_live_nudge_evaluations_last_evaluated_at",
        "live_nudge_evaluations",
        ["last_evaluated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_live_nudge_evaluations_last_evaluated_at", table_name="live_nudge_evaluations")
    op.drop_table("live_nudge_evaluations")
