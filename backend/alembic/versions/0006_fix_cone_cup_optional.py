"""Ensure Cone/Cup modifier assignments are optional.

Revision ID: 0006_fix_cone_cup_optional
Revises: 0005_mod_optional
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006_fix_cone_cup_optional"
down_revision: str | None = "0005_mod_optional"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Repair production Cone/Cup assignment data."""
    op.execute(
        "UPDATE product_modifier_groups "
        "SET is_required = false, min_select = 0 "
        "WHERE group_id IN ("
        "SELECT id FROM modifier_groups WHERE name = 'Cone/Cup'"
        ")"
    )


def downgrade() -> None:
    """Do not rewrite assignment data on downgrade."""
    pass
