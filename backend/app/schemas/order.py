"""Order request and response schemas."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.order import OrderStatus
from app.schemas.common import Money, ORMModel, TimestampSchema, UUIDSchema
from app.schemas.voucher import OrderVoucherRead


class SelectedModifier(BaseModel):
    """Modifier snapshot stored on an order item."""

    modifier_name: str = Field(min_length=1, max_length=120)
    price_adjustment: Money = Decimal("0.00")


class OrderItemCreate(BaseModel):
    """Payload for creating an order item."""

    product_id: UUID
    quantity: int = Field(ge=1)
    modifiers: list[SelectedModifier] = []
    notes: str | None = Field(default=None, max_length=500)


class OrderItemRead(UUIDSchema):
    """Order item response payload."""

    order_id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price: Money
    modifiers: list[SelectedModifier]
    notes: str | None
    created_at: datetime


class OrderCreate(BaseModel):
    """Payload for creating an order."""

    outlet_id: UUID
    staff_id: UUID
    items: list[OrderItemCreate] = Field(min_length=1)
    payment_method: str | None = Field(default=None, max_length=40)
    payment_reference: str | None = Field(default=None, max_length=255)
    loyalty_member_id: UUID | None = None
    loyalty_points_redeemed: int | None = Field(default=None, ge=0)
    loyalty_discount: Money | None = Field(default=None, ge=0)
    customer_id: str | None = Field(default=None, max_length=120)
    # Voucher codes to apply atomically at order creation time
    voucher_codes: list[str] | None = Field(default=None, max_length=20)


class OrderStatusUpdate(BaseModel):
    """Payload for updating order status and payment fields."""

    status: OrderStatus
    payment_method: str | None = Field(default=None, max_length=40)
    payment_reference: str | None = Field(default=None, max_length=255)
    cash_tendered: Decimal | None = Field(default=None, ge=0)
    cash_amount: Decimal | None = Field(default=None, ge=0)
    card_amount: Decimal | None = Field(default=None, ge=0)
    voucher_amount: Decimal | None = Field(default=None, ge=0)
    cdc_amount: Decimal | None = Field(default=None, ge=0)
    paynow_confirmed_at: datetime | None = None


class OrderRead(TimestampSchema):
    """Order response payload."""

    order_number: str
    outlet_id: UUID
    staff_id: UUID
    subtotal: Money
    total: Money
    status: OrderStatus
    payment_method: str | None
    payment_reference: str | None
    cash_tendered: Money | None = None
    cash_change: Money | None = None
    cash_amount: Money | None = None
    card_amount: Money | None = None
    voucher_amount: Money | None = None
    cdc_amount: Money | None = None
    paynow_confirmed_at: datetime | None = None
    loyalty_member_id: UUID | None = None
    customer_id: str | None = None
    loyalty_points_earned: int | None = None
    loyalty_points_redeemed: int | None = None
    loyalty_discount: Money | None = None
    items: list[OrderItemRead] = []
    # Applied vouchers (populated when present)
    applied_vouchers: list[OrderVoucherRead] | None = None
    voucher_discount: Money | None = None


class OrderRefundCreate(BaseModel):
    """Payload for refunding an order."""

    reason: str | None = Field(default=None, max_length=500)
    amount: Money | None = Field(default=None, gt=0)
    manager_pin: str | None = Field(
        default=None, description="Manager PIN, required when a non-manager initiates the refund"
    )


class RefundRead(UUIDSchema):
    """Refund audit record response payload."""

    order_id: UUID
    staff_id: UUID
    amount: Money
    reason: str | None
    kind: str
    created_at: datetime


class OrderAddItem(OrderItemCreate):
    """Payload for adding an item to an existing order."""
    pass


class OrderSummaryRead(ORMModel):
    """Compact order response payload."""

    id: UUID
    order_number: str
    outlet_id: UUID
    staff_id: UUID
    subtotal: Money
    total: Money
    status: OrderStatus
    payment_method: str | None
    payment_reference: str | None
    cash_tendered: Money | None = None
    cash_change: Money | None = None
    cash_amount: Money | None = None
    card_amount: Money | None = None
    voucher_amount: Money | None = None
    cdc_amount: Money | None = None
    paynow_confirmed_at: datetime | None = None
    loyalty_member_id: UUID | None = None
    customer_id: str | None = None
    loyalty_points_earned: int | None = None
    loyalty_points_redeemed: int | None = None
    loyalty_discount: Money | None = None
    created_at: datetime
    updated_at: datetime
