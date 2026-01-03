"""webhooks_and_deploy_tokens

Revision ID: c1a2b3d4e5f6
Revises: 87a893d57c86
Create Date: 2025-12-30 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1a2b3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "87a893d57c86"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create team_webhook table
    op.create_table(
        "team_webhook",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("team_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("secret", sa.String(length=512), nullable=True),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("project_ids", sa.JSON(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "disabled", name="team_webhook_status"),
            nullable=False,
        ),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id"],
            ["team.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["user.id"], ondelete="SET NULL", use_alter=True
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_team_webhook_team_id"), "team_webhook", ["team_id"], unique=False
    )
    op.create_index(
        op.f("ix_team_webhook_created_at"), "team_webhook", ["created_at"], unique=False
    )
    op.create_index(
        op.f("ix_team_webhook_updated_at"), "team_webhook", ["updated_at"], unique=False
    )

    # Create deploy_token table
    op.create_table(
        "deploy_token",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("token", sa.String(length=128), nullable=False),
        sa.Column("environment_id", sa.String(length=8), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "revoked", name="deploy_token_status"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["user.id"], ondelete="SET NULL", use_alter=True
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index(
        op.f("ix_deploy_token_project_id"), "deploy_token", ["project_id"], unique=False
    )
    op.create_index(
        op.f("ix_deploy_token_created_at"), "deploy_token", ["created_at"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Drop deploy_token table
    op.drop_index(op.f("ix_deploy_token_created_at"), table_name="deploy_token")
    op.drop_index(op.f("ix_deploy_token_project_id"), table_name="deploy_token")
    op.drop_table("deploy_token")
    op.execute("DROP TYPE IF EXISTS deploy_token_status")

    # Drop team_webhook table
    op.drop_index(op.f("ix_team_webhook_updated_at"), table_name="team_webhook")
    op.drop_index(op.f("ix_team_webhook_created_at"), table_name="team_webhook")
    op.drop_index(op.f("ix_team_webhook_team_id"), table_name="team_webhook")
    op.drop_table("team_webhook")
    op.execute("DROP TYPE IF EXISTS team_webhook_status")
