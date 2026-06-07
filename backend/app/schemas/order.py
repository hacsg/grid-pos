"""Order request and response schemas."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.order import OrderStatus
from app.schemas.common import Money, ORMModel, TimestampSchema, UUIDSchema


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
    status: OrderStatus = OrderStatus.pending
    payment_method: str | None = Field(default=None, max_length=40)
    payment_reference: str | None = Field(default=None, max_length=255)


class OrderStatusUpdate(BaseModel):
    """Payload for updating order status and payment fields."""

    status: OrderStatus
    payment_method: str | None = Field(default=None, max_length=40)
    payment_reference: str | None = Field(default=None, max_length=255)


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
    items: list[OrderItemRead] = []


class OrderRefundCreate(BaseModel):
    """Payload for refunding an order."""

    reason: str | None = Field(default=None, max_length=500)


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
    created_at: datetime
    updated_at: datetime

