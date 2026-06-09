"""Track signup campaign attribution.

Revision ID: 0008_campaign_signup
Revises: 0007_modifier_group_sort_order
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError

revision: str = "0008_campaign_signup"
down_revision: str | None = "0007_modifier_group_sort_order"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    columns = inspect(op.get_bind()).get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def _safe_create_fk(
    name: str,
    source_table: str,
    referent_table: str,
    local_cols: list[str],
    remote_cols: list[str],
    ondelete: str = "SET NULL",
) -> None:
    try:
        op.create_foreign_key(
            name,
            source_table,
            referent_table,
            local_cols,
            remote_cols,
            ondelete=ondelete,
        )
    except Exception:
        # Idempotent migration: the constraint may already exist or the dialect may
        # not support ALTER TABLE ADD CONSTRAINT in local test databases.
        pass


def _safe_create_index(name: str, table_name: str, columns: list[str]) -> None:
    try:
        op.create_index(name, table_name, columns, unique=False, if_not_exists=True)
    except TypeError:
        try:
            op.create_index(name, table_name, columns, unique=False)
        except Exception:
            pass
    except Exception:
        pass


def _safe_drop_column(table_name: str, column_name: str) -> None:
    if not _has_column(table_name, column_name):
        return
    try:
        op.drop_column(table_name, column_name)
    except Exception:
        pass


def upgrade() -> None:
    """Add signup attribution and campaign voucher settings."""
    if not _has_table("campaigns"):
        op.create_table(
            "campaigns",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("channel", sa.String(length=80), nullable=True),
            sa.Column("code_prefix", sa.String(length=64), nullable=False),
            sa.Column("budget_cents", sa.Integer(), nullable=True),
            sa.Column("discount_cents", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("auto_issue_on_signup", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("signup_voucher_discount_cents", sa.Integer(), nullable=True),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_campaigns")),
        )
        _safe_create_index("ix_campaigns_code_prefix", "campaigns", ["code_prefix"])
    else:
        if not _has_column("campaigns", "auto_issue_on_signup"):
            op.add_column(
                "campaigns",
                sa.Column("auto_issue_on_signup", sa.Boolean(), nullable=False, server_default="false"),
            )
        if not _has_column("campaigns", "signup_voucher_discount_cents"):
            op.add_column(
                "campaigns",
                sa.Column("signup_voucher_discount_cents", sa.Integer(), nullable=True),
            )

    if not _has_table("customers"):
        op.create_table(
            "customers",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=True),
            sa.Column("phone", sa.String(length=20), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("tier", sa.String(length=20), nullable=False, server_default="bronze"),
            sa.Column("moments_total", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("signup_campaign_id", sa.Uuid(), nullable=True),
            sa.ForeignKeyConstraint(
                ["signup_campaign_id"],
                ["campaigns.id"],
                name=op.f("fk_customers_signup_campaign_id_campaigns"),
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_customers")),
            sa.UniqueConstraint("phone", name=op.f("uq_customers_phone")),
        )
        _safe_create_index("ix_customers_phone", "customers", ["phone"])
        _safe_create_index("ix_customers_signup_campaign_id", "customers", ["signup_campaign_id"])
    elif not _has_column("customers", "signup_campaign_id"):
        op.add_column("customers", sa.Column("signup_campaign_id", sa.Uuid(), nullable=True))
        _safe_create_index("ix_customers_signup_campaign_id", "customers", ["signup_campaign_id"])
        if _has_table("campaigns"):
            _safe_create_fk(
                op.f("fk_customers_signup_campaign_id_campaigns"),
                "customers",
                "campaigns",
                ["signup_campaign_id"],
                ["id"],
            )

    if _has_table("vouchers"):
        voucher_columns = [
            ("customer_id", sa.Column("customer_id", sa.Uuid(), nullable=True)),
            ("campaign_id", sa.Column("campaign_id", sa.Uuid(), nullable=True)),
            ("discount_cents", sa.Column("discount_cents", sa.Integer(), nullable=True)),
            ("status", sa.Column("status", sa.String(length=20), nullable=False, server_default="available")),
            ("expires_at", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True)),
            ("redeemed_order_id", sa.Column("redeemed_order_id", sa.Uuid(), nullable=True)),
            ("voided_at", sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True)),
        ]
        for column_name, column in voucher_columns:
            if not _has_column("vouchers", column_name):
                op.add_column("vouchers", column)

        _safe_create_index("ix_vouchers_customer_id", "vouchers", ["customer_id"])
        _safe_create_index("ix_vouchers_campaign_id", "vouchers", ["campaign_id"])
        _safe_create_index("ix_vouchers_redeemed_order_id", "vouchers", ["redeemed_order_id"])
        if _has_table("customers"):
            _safe_create_fk(
                op.f("fk_vouchers_customer_id_customers"),
                "vouchers",
                "customers",
                ["customer_id"],
                ["id"],
            )
        if _has_table("campaigns"):
            _safe_create_fk(
                op.f("fk_vouchers_campaign_id_campaigns"),
                "vouchers",
                "campaigns",
                ["campaign_id"],
                ["id"],
            )
        if _has_table("orders"):
            _safe_create_fk(
                op.f("fk_vouchers_redeemed_order_id_orders"),
                "vouchers",
                "orders",
                ["redeemed_order_id"],
                ["id"],
            )

    if _has_table("orders") and not _has_column("orders", "customer_id"):
        op.add_column("orders", sa.Column("customer_id", sa.String(length=120), nullable=True))
        _safe_create_index("ix_orders_customer_id", "orders", ["customer_id"])


def downgrade() -> None:
    """Remove signup attribution columns."""
    for table_name, column_name in [
        ("orders", "customer_id"),
        ("vouchers", "voided_at"),
        ("vouchers", "redeemed_order_id"),
        ("vouchers", "expires_at"),
        ("vouchers", "status"),
        ("vouchers", "discount_cents"),
        ("vouchers", "campaign_id"),
        ("vouchers", "customer_id"),
        ("customers", "signup_campaign_id"),
        ("campaigns", "signup_voucher_discount_cents"),
        ("campaigns", "auto_issue_on_signup"),
    ]:
        _safe_drop_column(table_name, column_name)
