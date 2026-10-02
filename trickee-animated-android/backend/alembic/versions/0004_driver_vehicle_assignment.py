"""Assign each pilot driver to one active vehicle.

Revision ID: 0004_driver_vehicle_assignment
Revises: 0003_realtime_processing
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_driver_vehicle_assignment"
down_revision = "0003_realtime_processing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("drivers") as batch:
        batch.add_column(sa.Column("assigned_vehicle_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_drivers_assigned_vehicle_id_vehicles",
            "vehicles",
            ["assigned_vehicle_id"],
            ["id"],
        )
        batch.create_index("ix_drivers_assigned_vehicle_id", ["assigned_vehicle_id"])


def downgrade() -> None:
    with op.batch_alter_table("drivers") as batch:
        batch.drop_index("ix_drivers_assigned_vehicle_id")
        batch.drop_constraint("fk_drivers_assigned_vehicle_id_vehicles", type_="foreignkey")
        batch.drop_column("assigned_vehicle_id")
