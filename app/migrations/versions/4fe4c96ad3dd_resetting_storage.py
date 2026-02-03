"""Resetting storage

Revision ID: 4fe4c96ad3dd
Revises: d02fb88a3355
Create Date: 2026-02-03 13:58:33.470435

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4fe4c96ad3dd"
down_revision: Union[str, Sequence[str], None] = "d02fb88a3355"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


new_status_enum = sa.Enum(
    "pending", "active", "resetting", "deleted", name="storage_status_new"
)
old_status_enum = sa.Enum(
    "pending", "active", "deleted", name="storage_status_old"
)


def upgrade() -> None:
    """Upgrade schema."""
    new_status_enum.create(op.get_bind(), checkfirst=True)

    op.execute("ALTER TABLE storage ALTER COLUMN status DROP DEFAULT")
    op.execute(
        """
        ALTER TABLE storage
        ALTER COLUMN status TYPE storage_status_new
        USING status::text::storage_status_new
        """
    )
    op.execute("DROP TYPE storage_status")
    op.execute("ALTER TYPE storage_status_new RENAME TO storage_status")
    op.execute("ALTER TABLE storage ALTER COLUMN status SET DEFAULT 'pending'")


def downgrade() -> None:
    """Downgrade schema."""
    old_status_enum.create(op.get_bind(), checkfirst=True)
    op.execute("ALTER TABLE storage ALTER COLUMN status DROP DEFAULT")
    op.execute(
        """
        UPDATE storage
        SET status = CASE
            WHEN status = 'resetting' THEN 'active'
            ELSE status
        END
        """
    )
    op.execute(
        "ALTER TABLE storage ALTER COLUMN status TYPE storage_status_old USING status::text::storage_status_old"
    )
    op.execute("DROP TYPE storage_status")
    op.execute("ALTER TYPE storage_status_old RENAME TO storage_status")
    op.execute("ALTER TABLE storage ALTER COLUMN status SET DEFAULT 'pending'")
