"""Voucher request and response schemas."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.voucher import VoucherType
from app.schemas.common import Money, ORMModel, TimestampSchema, UUIDSchema


class VoucherCreate(BaseModel):
    """Admin payload to create a (CDC) voucher."""

    code: str = Field(min_length=3, max_length=64)
    type: VoucherType = VoucherType.cdc
    amount: Money = Field(ge=0)


class VoucherRead(TimestampSchema):
    """Voucher response payload."""

    code: str
    type: VoucherType
    amount: Money
    customer_id: UUID | None = None
    campaign_id: UUID | None = None
    discount_cents: int | None = None
    status: str = "available"
    expires_at: datetime | None = None
    redeemed_at: datetime | None = None
    redeemed_order_id: UUID | None = None
    redeemed_by_staff_id: UUID | None = None
    outlet_id: UUID | None = None
    order_id: UUID | None = None
    voided_at: datetime | None = None


class VoucherValidateRequest(BaseModel):
    """Request body for validating a voucher code before applying."""

    code: str = Field(min_length=1, max_length=64)


class VoucherValidateRead(BaseModel):
    """Response for a successful validation (voucher is available)."""

    id: UUID
    code: str
    type: VoucherType
    amount: Money
    is_valid: bool = True


class VoucherApplyRequest(BaseModel):
    """Apply one or more voucher codes to a pending order."""

    codes: list[str] = Field(min_length=1, max_length=20)


class OrderVoucherRead(UUIDSchema):
    """Compact view of a voucher applied to an order."""

    voucher_id: UUID
    code: str
    type: VoucherType
    amount_applied: Money
    created_at: datetime


class VoucherListParams(BaseModel):
    """Optional filters for listing vouchers (admin)."""

    type: VoucherType | None = None
    redeemed: bool | None = None  # true = redeemed, false = available, null = all
    outlet_id: UUID | None = None
    order_id: UUID | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
