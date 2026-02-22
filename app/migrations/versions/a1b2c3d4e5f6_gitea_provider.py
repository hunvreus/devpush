"""Add Gitea provider support

Revision ID: a1b2c3d4e5f6
Revises: 4fe4c96ad3dd
Create Date: 2026-02-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "4fe4c96ad3dd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

repo_provider_enum = sa.Enum("github", "gitea", name="repo_provider")


def upgrade() -> None:
    repo_provider_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "gitea_connection",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False, index=True),
        sa.Column("base_url", sa.String(512), nullable=False),
        sa.Column("username", sa.String(255), nullable=False),
        sa.Column("token", sa.String(2048), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "base_url", name="uq_gitea_connection_user_url"),
    )

    # Project: add repo_provider, repo_base_url, gitea_connection_id; make github_installation_id nullable
    op.add_column("project", sa.Column("repo_provider", repo_provider_enum, nullable=True))
    op.add_column("project", sa.Column("repo_base_url", sa.String(512), nullable=True))
    op.add_column(
        "project",
        sa.Column("gitea_connection_id", sa.Integer(), sa.ForeignKey("gitea_connection.id"), nullable=True, index=True),
    )

    op.execute("UPDATE project SET repo_provider = 'github', repo_base_url = 'https://github.com'")

    op.alter_column("project", "repo_provider", nullable=False)
    op.alter_column("project", "repo_base_url", nullable=False)
    op.alter_column("project", "github_installation_id", nullable=True)

    # Deployment: add repo_provider, repo_base_url
    op.add_column("deployment", sa.Column("repo_provider", repo_provider_enum, nullable=True))
    op.add_column("deployment", sa.Column("repo_base_url", sa.String(512), nullable=True))

    op.execute("UPDATE deployment SET repo_provider = 'github', repo_base_url = 'https://github.com'")

    op.alter_column("deployment", "repo_provider", nullable=False)
    op.alter_column("deployment", "repo_base_url", nullable=False)


def downgrade() -> None:
    op.drop_column("deployment", "repo_base_url")
    op.drop_column("deployment", "repo_provider")

    op.alter_column("project", "github_installation_id", nullable=False)
    op.drop_column("project", "gitea_connection_id")
    op.drop_column("project", "repo_base_url")
    op.drop_column("project", "repo_provider")

    op.drop_table("gitea_connection")

    repo_provider_enum.drop(op.get_bind(), checkfirst=True)
