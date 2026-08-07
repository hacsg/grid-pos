"""Add is_gift_card flag to products for physical gift card SKUs.

Revision ID: 0009_product_is_gift_card
Revises: 0008_campaign_signup
Create Date: 2026-04-10 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_product_is_gift_card"
down_revision: str | None = "0008_campaign_signup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add non-null is_gift_card column defaulting to false."""
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name='products' AND column_name='is_gift_card')"
        )
    )
    column_exists = result.scalar()
    if not column_exists:
        op.add_column(
            "products",
            sa.Column(
                "is_gift_card",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )


def downgrade() -> None:
    """Remove is_gift_card column (best effort)."""
    try:
        op.drop_column("products", "is_gift_card")
    except Exception:
        pass
