"""Voucher and OrderVoucher SQLAlchemy models."""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import UUID

from sqlalchemy import ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin


class VoucherType(str, Enum):
    """Supported voucher sources."""

    cdc = "cdc"
    acre_group = "acre_group"


class Voucher(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Voucher that can be redeemed against an order."""

    __tablename__ = "vouchers"

    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    type: Mapped[VoucherType] = mapped_column(
        SQLEnum(VoucherType, name="voucher_type"),
        nullable=False,
        index=True,
    )
    amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    customer_id: Mapped[Optional[UUID]] = mapped_column(
        Uuid,
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    campaign_id: Mapped[Optional[UUID]] = mapped_column(
        Uuid,
        ForeignKey("campaigns.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    discount_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="available")
    expires_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    redeemed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    redeemed_order_id: Mapped[Optional[UUID]] = mapped_column(
        Uuid,
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    redeemed_by_staff_id: Mapped[Optional[UUID]] = mapped_column(
        Uuid,
        ForeignKey("staff.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    outlet_id: Mapped[Optional[UUID]] = mapped_column(
        Uuid,
        ForeignKey("outlets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    order_id: Mapped[Optional[UUID]] = mapped_column(
        Uuid,
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    voided_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    customer = relationship("Customer", foreign_keys=[customer_id], back_populates="vouchers")
    campaign = relationship("Campaign", foreign_keys=[campaign_id], back_populates="vouchers")
    redeemed_by_staff = relationship("Staff", foreign_keys=[redeemed_by_staff_id])
    outlet = relationship("Outlet", foreign_keys=[outlet_id])
    order = relationship("Order", foreign_keys=[order_id], back_populates="vouchers")
    redeemed_order = relationship("Order", foreign_keys=[redeemed_order_id])
    order_voucher_links = relationship(
        "OrderVoucher", back_populates="voucher", cascade="all, delete-orphan"
    )


class OrderVoucher(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Junction table recording which vouchers were applied to an order and for how much."""

    __tablename__ = "order_vouchers"
    __table_args__ = (UniqueConstraint("order_id", "voucher_id", name="uq_order_voucher"),)

    order_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    voucher_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("vouchers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    amount_applied: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default="0")

    order = relationship("Order", back_populates="order_voucher_links")
    voucher = relationship("Voucher", back_populates="order_voucher_links")
