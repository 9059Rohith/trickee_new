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


def downgrade() -> None:
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
