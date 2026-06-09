"""Add sort_order column to modifier_groups table.

Revision ID: 0007_modifier_group_sort_order
Revises: 0006_fix_cone_cup_optional
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0007_modifier_group_sort_order"
down_revision: str | None = "0006_fix_cone_cup_optional"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add sort_order column to modifier_groups."""
    op.add_column(
        "modifier_groups",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    """Remove sort_order column from modifier_groups."""
    op.drop_column("modifier_groups", "sort_order")