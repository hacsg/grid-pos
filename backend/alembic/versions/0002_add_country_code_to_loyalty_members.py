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
    """Create loyalty_members table if missing, then ensure country_code column exists."""
    conn = op.get_bind()
    
    # Check if loyalty_members table exists
    result = conn.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'loyalty_members')")
    )
    table_exists = result.scalar()
    
    if not table_exists:
        # Create the full table with country_code already included
        op.create_table(
            "loyalty_members",
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("phone", sa.String(length=20), nullable=False),
            sa.Column("points", sa.Integer(), nullable=False, default=0),
            sa.Column("tier", sa.String(length=20), nullable=False, default="bronze"),
            sa.Column("total_spent", sa.Numeric(precision=12, scale=2), nullable=False, default=0),
            sa.Column("country_code", sa.String(length=5), nullable=False, server_default="+65"),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_loyalty_members")),
        )
        op.create_index(op.f("ix_loyalty_members_phone"), "loyalty_members", ["phone"], unique=True)
    else:
        # Table exists — check if country_code column exists
        result = conn.execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'loyalty_members' AND column_name = 'country_code')")
        )
        column_exists = result.scalar()
        
        if not column_exists:
            # Add column as nullable first to handle existing data
            op.add_column(
                "loyalty_members",
                sa.Column("country_code", sa.String(length=5), nullable=True),
            )
            # Backfill existing rows with '+65'
            op.execute("UPDATE loyalty_members SET country_code = '+65' WHERE country_code IS NULL")
            # Make the column NOT NULL with server default
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
