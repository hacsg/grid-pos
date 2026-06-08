"""Modifier system refactor + selected_modifiers on order_items

Revision ID: 0003
Revises: 0002_country_code
Create Date: 2026-06-07 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_modifiers"
down_revision: str | None = "0002_country_code"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create new modifier_groups / modifier_options / product_modifier_groups.

    Drop legacy modifier_groups and modifiers tables from initial schema.
    Add selected_modifiers JSONB (nullable) to order_items.
    """
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # ------------------------------------------------------------------
    # Drop legacy modifier tables (and their indexes) if they exist.
    # ------------------------------------------------------------------
    # Legacy "modifiers" table (children)
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'modifiers')"
        )
    )
    if result.scalar():
        # Drop index if present
        try:
            op.drop_index(
                op.f("ix_modifiers_modifier_group_id"), table_name="modifiers"
            )
        except Exception:
            pass
        op.drop_table("modifiers")

    # Legacy "modifier_groups" table
    result = conn.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'modifier_groups')"
        )
    )
    if result.scalar():
        try:
            op.drop_index(
                op.f("ix_modifier_groups_product_id"), table_name="modifier_groups"
            )
        except Exception:
            pass
        op.drop_table("modifier_groups")

    # ------------------------------------------------------------------
    # New tables
    # ------------------------------------------------------------------
    op.create_table(
        "modifier_groups",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_modifier_groups")),
    )
    op.create_index(
        op.f("ix_modifier_groups_name"), "modifier_groups", ["name"], unique=False
    )

    op.create_table(
        "modifier_options",
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "price_adjustment",
            sa.Numeric(precision=10, scale=2),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "display_order", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column(
            "is_available", sa.Boolean(), server_default="true", nullable=False
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["modifier_groups.id"],
            name=op.f("fk_modifier_options_group_id_modifier_groups"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_modifier_options")),
    )
    op.create_index(
        op.f("ix_modifier_options_group_id"),
        "modifier_options",
        ["group_id"],
        unique=False,
    )

    op.create_table(
        "product_modifier_groups",
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("min_select", sa.Integer(), server_default="1", nullable=False),
        sa.Column("max_select", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "is_required", sa.Boolean(), server_default="true", nullable=False
        ),
        sa.Column("display_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_product_modifier_groups_product_id_products"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["modifier_groups.id"],
            name=op.f("fk_product_modifier_groups_group_id_modifier_groups"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_product_modifier_groups")),
        sa.UniqueConstraint(
            "product_id",
            "group_id",
            name=op.f("uq_product_modifier_groups_product_id_group_id"),
        ),
    )
    op.create_index(
        op.f("ix_product_modifier_groups_product_id"),
        "product_modifier_groups",
        ["product_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_product_modifier_groups_group_id"),
        "product_modifier_groups",
        ["group_id"],
        unique=False,
    )

    # ------------------------------------------------------------------
    # Add selected_modifiers column to order_items (nullable, default empty)
    # ------------------------------------------------------------------
    # Check if column already exists (defensive for re-runs)
    result = conn.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name='order_items' AND column_name='selected_modifiers')"
        )
    )
    column_exists = result.scalar()
    if not column_exists:
        if is_postgres:
            op.add_column(
                "order_items",
                sa.Column(
                    "selected_modifiers",
                    postgresql.JSONB(astext_type=sa.Text()),
                    nullable=True,
                    server_default=sa.text("'[]'::jsonb"),
                ),
            )
            # Ensure default is applied to existing rows
            op.execute(
                "UPDATE order_items SET selected_modifiers = '[]'::jsonb "
                "WHERE selected_modifiers IS NULL"
            )
        else:
            op.add_column(
                "order_items",
                sa.Column("selected_modifiers", sa.JSON(), nullable=True),
            )
            op.execute(
                "UPDATE order_items SET selected_modifiers = '[]' "
                "WHERE selected_modifiers IS NULL"
            )


def downgrade() -> None:
    """Reverse the modifier schema changes."""
    # Drop new tables
    op.drop_index(
        op.f("ix_product_modifier_groups_group_id"),
        table_name="product_modifier_groups",
    )
    op.drop_index(
        op.f("ix_product_modifier_groups_product_id"),
        table_name="product_modifier_groups",
    )
    op.drop_table("product_modifier_groups")

    op.drop_index(
        op.f("ix_modifier_options_group_id"), table_name="modifier_options"
    )
    op.drop_table("modifier_options")

    op.drop_index(op.f("ix_modifier_groups_name"), table_name="modifier_groups")
    op.drop_table("modifier_groups")

    # Drop the added column (best effort)
    try:
        op.drop_column("order_items", "selected_modifiers")
    except Exception:
        pass

    # Note: We do not recreate the legacy modifier tables on downgrade.
