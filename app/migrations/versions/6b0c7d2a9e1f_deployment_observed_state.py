"""Deployment observed state

Revision ID: 6b0c7d2a9e1f
Revises: f45484bf96b0
Create Date: 2026-01-29 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "6b0c7d2a9e1f"
down_revision: Union[str, Sequence[str], None] = "f45484bf96b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


observed_status_enum = sa.Enum(
    "running",
    "exited",
    "dead",
    "paused",
    "not_found",
    name="deployment_observed_status",
)


def upgrade() -> None:
    """Upgrade schema."""
    observed_status_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "deployment",
        sa.Column("observed_status", observed_status_enum, nullable=True),
    )
    op.add_column(
        "deployment",
        sa.Column("observed_exit_code", sa.Integer(), nullable=True),
    )
    op.add_column(
        "deployment",
        sa.Column("observed_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "deployment",
        sa.Column("observed_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "deployment",
        sa.Column("observed_last_seen_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "deployment",
        sa.Column(
            "observed_missing_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("deployment", "observed_missing_count")
    op.drop_column("deployment", "observed_last_seen_at")
    op.drop_column("deployment", "observed_reason")
    op.drop_column("deployment", "observed_at")
    op.drop_column("deployment", "observed_exit_code")
    op.drop_column("deployment", "observed_status")

    observed_status_enum.drop(op.get_bind(), checkfirst=True)
