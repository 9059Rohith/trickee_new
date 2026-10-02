"""Add provenance-safe observed trip energy labels.

Revision ID: 0005_trip_energy_labels
Revises: 0004_driver_vehicle_assignment
Create Date: 2026-08-30
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_trip_energy_labels"
down_revision = "0004_driver_vehicle_assignment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trip_energy_labels",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("trip_id", sa.String(36), nullable=False),
        sa.Column("starting_soc_pct", sa.Float(), nullable=True),
        sa.Column("ending_soc_pct", sa.Float(), nullable=True),
        sa.Column("soc_delta_pct", sa.Float(), nullable=True),
        sa.Column("actual_energy_consumed_wh", sa.Float(), nullable=True),
        sa.Column("actual_wh_per_km", sa.Float(), nullable=True),
        sa.Column("usable_kwh_snapshot", sa.Float(), nullable=True),
        sa.Column("label_source", sa.String(50), nullable=False),
        sa.Column("label_confidence", sa.Float(), nullable=False),
        sa.Column("is_training_eligible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("eligibility_reason", sa.String(80), nullable=False),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["mobile_trip_sessions.id"]),
        sa.UniqueConstraint("trip_id", name="uq_trip_energy_labels_trip_id"),
    )
    op.create_index("ix_trip_energy_labels_trip_id", "trip_energy_labels", ["trip_id"])
    op.create_index(
        "ix_trip_energy_labels_is_training_eligible",
        "trip_energy_labels",
        ["is_training_eligible"],
    )


def downgrade() -> None:
    op.drop_index("ix_trip_energy_labels_is_training_eligible", table_name="trip_energy_labels")
    op.drop_index("ix_trip_energy_labels_trip_id", table_name="trip_energy_labels")
    op.drop_table("trip_energy_labels")
