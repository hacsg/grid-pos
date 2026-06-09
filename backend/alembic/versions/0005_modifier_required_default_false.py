"""Make product modifier assignments optional by default.

Revision ID: 0005_modifier_required_default_false
Revises: 0004_product_description
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_mod_optional"
down_revision: str | None = "0004_product_description"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Switch product_modifier_groups.is_required default to false."""
    op.alter_column(
        "product_modifier_groups",
        "is_required",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("false"),
        existing_nullable=False,
    )
    # Make Cone/Cup groups optional; leave others (e.g. Gelato Flavors) as required
    op.execute(
        "UPDATE product_modifier_groups "
        "SET is_required = false, min_select = 0 "
        "WHERE group_id IN ("
        "SELECT id FROM modifier_groups "
        "WHERE name = 'Cone/Cup' "
        "OR name ILIKE '%cone%cup%' "
        "OR name ILIKE '%cup%cone%'"
        ")"
    )


def downgrade() -> None:
    """Restore the prior true default without rewriting assignment data."""
    op.alter_column(
        "product_modifier_groups",
        "is_required",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("true"),
        existing_nullable=False,
    )
