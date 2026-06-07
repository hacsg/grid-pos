"""initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-06-07 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

order_status_enum = postgresql.ENUM(
    "pending",
    "paid",
    "refunded",
    "cancelled",
    name="order_status",
    create_type=False,
)
staff_role_enum = postgresql.ENUM(
    "cashier",
    "supervisor",
    "manager",
    "admin",
    name="staff_role",
    create_type=False,
)


def upgrade() -> None:
    """Create the initial Grid POS database schema."""
    bind = op.get_bind()
    order_status_enum.create(bind, checkfirst=True)
    staff_role_enum.create(bind, checkfirst=True)

    op.create_table(
        "outlets",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outlets")),
        sa.UniqueConstraint("name", name=op.f("uq_outlets_name")),
    )
    op.create_index(op.f("ix_outlets_name"), "outlets", ["name"], unique=False)

    op.create_table(
        "categories",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("outlet_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["outlet_id"],
            ["outlets.id"],
            name=op.f("fk_categories_outlet_id_outlets"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_categories")),
    )
    op.create_index(op.f("ix_categories_name"), "categories", ["name"], unique=False)
    op.create_index(op.f("ix_categories_outlet_id"), "categories", ["outlet_id"], unique=False)

    op.create_table(
        "staff",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("pin_hash", sa.String(length=255), nullable=False),
        sa.Column("role", staff_role_enum, nullable=False),
        sa.Column("outlet_id", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["outlet_id"],
            ["outlets.id"],
            name=op.f("fk_staff_outlet_id_outlets"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_staff")),
    )
    op.create_index(op.f("ix_staff_name"), "staff", ["name"], unique=False)
    op.create_index(op.f("ix_staff_outlet_id"), "staff", ["outlet_id"], unique=False)

    op.create_table(
        "products",
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("price", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("image_url", sa.String(length=500), nullable=True),
        sa.Column("is_available", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name=op.f("fk_products_category_id_categories"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_products")),
    )
    op.create_index(op.f("ix_products_category_id"), "products", ["category_id"], unique=False)
    op.create_index(op.f("ix_products_name"), "products", ["name"], unique=False)

    op.create_table(
        "modifier_groups",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("required", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("min_select", sa.Integer(), server_default="0", nullable=False),
        sa.Column("max_select", sa.Integer(), server_default="1", nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_modifier_groups_product_id_products"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_modifier_groups")),
    )
    op.create_index(op.f("ix_modifier_groups_product_id"), "modifier_groups", ["product_id"], unique=False)

    op.create_table(
        "orders",
        sa.Column("order_number", sa.String(length=16), nullable=False),
        sa.Column("outlet_id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("subtotal", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("total", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("status", order_status_enum, server_default="pending", nullable=False),
        sa.Column("payment_method", sa.String(length=40), nullable=True),
        sa.Column("payment_reference", sa.String(length=255), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["outlet_id"],
            ["outlets.id"],
            name=op.f("fk_orders_outlet_id_outlets"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"],
            ["staff.id"],
            name=op.f("fk_orders_staff_id_staff"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_orders")),
    )
    op.create_index(op.f("ix_orders_order_number"), "orders", ["order_number"], unique=False)
    op.create_index(op.f("ix_orders_outlet_created_at"), "orders", ["outlet_id", "created_at"], unique=False)
    op.create_index(op.f("ix_orders_outlet_id"), "orders", ["outlet_id"], unique=False)
    op.create_index(op.f("ix_orders_staff_id"), "orders", ["staff_id"], unique=False)

    op.create_table(
        "modifiers",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("price_adjustment", sa.Numeric(precision=10, scale=2), server_default="0", nullable=False),
        sa.Column("modifier_group_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["modifier_group_id"],
            ["modifier_groups.id"],
            name=op.f("fk_modifiers_modifier_group_id_modifier_groups"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_modifiers")),
    )
    op.create_index(op.f("ix_modifiers_modifier_group_id"), "modifiers", ["modifier_group_id"], unique=False)

    op.create_table(
        "order_items",
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("modifiers", sa.JSON(), nullable=False),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name=op.f("fk_order_items_order_id_orders"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_order_items_product_id_products"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_order_items")),
    )
    op.create_index(op.f("ix_order_items_order_id"), "order_items", ["order_id"], unique=False)
    op.create_index(op.f("ix_order_items_product_id"), "order_items", ["product_id"], unique=False)


def downgrade() -> None:
    """Drop the initial Grid POS database schema."""
    op.drop_index(op.f("ix_order_items_product_id"), table_name="order_items")
    op.drop_index(op.f("ix_order_items_order_id"), table_name="order_items")
    op.drop_table("order_items")
    op.drop_index(op.f("ix_modifiers_modifier_group_id"), table_name="modifiers")
    op.drop_table("modifiers")
    op.drop_index(op.f("ix_orders_staff_id"), table_name="orders")
    op.drop_index(op.f("ix_orders_outlet_id"), table_name="orders")
    op.drop_index(op.f("ix_orders_outlet_created_at"), table_name="orders")
    op.drop_index(op.f("ix_orders_order_number"), table_name="orders")
    op.drop_table("orders")
    op.drop_index(op.f("ix_modifier_groups_product_id"), table_name="modifier_groups")
    op.drop_table("modifier_groups")
    op.drop_index(op.f("ix_products_name"), table_name="products")
    op.drop_index(op.f("ix_products_category_id"), table_name="products")
    op.drop_table("products")
    op.drop_index(op.f("ix_staff_outlet_id"), table_name="staff")
    op.drop_index(op.f("ix_staff_name"), table_name="staff")
    op.drop_table("staff")
    op.drop_index(op.f("ix_categories_outlet_id"), table_name="categories")
    op.drop_index(op.f("ix_categories_name"), table_name="categories")
    op.drop_table("categories")
    op.drop_index(op.f("ix_outlets_name"), table_name="outlets")
    op.drop_table("outlets")

    bind = op.get_bind()
    staff_role_enum.drop(bind, checkfirst=True)
    order_status_enum.drop(bind, checkfirst=True)
