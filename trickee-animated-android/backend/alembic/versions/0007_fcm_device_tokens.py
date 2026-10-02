"""Add FCM registration tokens to telemetry devices.

Revision ID: 0007_fcm_device_tokens
Revises: 0006_route_nudge_delivery
Create Date: 2026-09-09
"""
from alembic import op
import sqlalchemy as sa


revision = "0007_fcm_device_tokens"
down_revision = "0006_route_nudge_delivery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("fcm_registration_token", sa.Text(), nullable=True))
    op.add_column("devices", sa.Column("fcm_token_updated_at", sa.DateTime(), nullable=True))
    op.create_index(
        "uq_devices_fcm_registration_token",
        "devices",
        ["fcm_registration_token"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_devices_fcm_registration_token", table_name="devices")
    op.drop_column("devices", "fcm_token_updated_at")
    op.drop_column("devices", "fcm_registration_token")
