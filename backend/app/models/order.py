"""Order SQLAlchemy model."""

from decimal import Decimal
from datetime import datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class OrderStatus(str, Enum):
    """Supported order lifecycle statuses."""

    pending = "pending"
    paid = "paid"
    refunded = "refunded"
    cancelled = "cancelled"


class Order(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Customer order placed at an outlet."""

    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_outlet_created_at", "outlet_id", "created_at"),)

    order_number: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    outlet_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("outlets.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    staff_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("staff.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[OrderStatus] = mapped_column(
        SQLEnum(OrderStatus, name="order_status"),
        nullable=False,
        default=OrderStatus.pending,
        server_default=OrderStatus.pending.value,
    )
    payment_method: Mapped[str | None] = mapped_column(String(40), nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cash_tendered: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    cash_change: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    cash_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    card_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    voucher_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    cdc_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    paynow_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    loyalty_member_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    loyalty_points_earned: Mapped[int | None] = mapped_column(Integer, nullable=True)
    loyalty_points_redeemed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    loyalty_discount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    outlet = relationship("Outlet", back_populates="orders")
    staff = relationship("Staff", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    order_voucher_links = relationship(
        "OrderVoucher", back_populates="order", cascade="all, delete-orphan"
    )
    vouchers = relationship(
        "Voucher",
        back_populates="order",
        foreign_keys="Voucher.order_id",
    )
    refunds = relationship("Refund", back_populates="order", cascade="all, delete-orphan")
