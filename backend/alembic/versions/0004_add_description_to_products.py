"""Add description column to products table.

Revision ID: 0004_product_description
Revises: 0003_modifiers
Create Date: 2026-06-07 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_product_description"
down_revision: str | None = "0003_modifiers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable description (TEXT) column to products table."""
    conn = op.get_bind()
    # Check if column already exists (idempotent / re-runnable)
    result = conn.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name='products' AND column_name='description')"
        )
    )
    column_exists = result.scalar()
    if not column_exists:
        op.add_column(
            "products",
            sa.Column("description", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    """Remove description column from products (best effort)."""
    try:
        op.drop_column("products", "description")
    except Exception:
        pass
