"""add country_code to loyalty_members

Revision ID: 0002_add_country_code_to_loyalty_members
Revises: 0001_initial_schema
Create Date: 2026-06-07 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_add_country_code_to_loyalty_members"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add country_code column to loyalty_members, default '+65' for existing rows."""
    # Add column as nullable first to handle existing data
    op.add_column(
        "loyalty_members",
        sa.Column("country_code", sa.String(length=5), nullable=True),
    )

    # Backfill existing rows with '+65'
    op.execute("UPDATE loyalty_members SET country_code = '+65' WHERE country_code IS NULL")

    # Make the column NOT NULL with server default for future inserts
    op.alter_column(
        "loyalty_members",
        "country_code",
        existing_type=sa.String(length=5),
        nullable=False,
        server_default="+65",
    )


def downgrade() -> None:
    """Remove country_code column from loyalty_members."""
    op.drop_column("loyalty_members", "country_code")
