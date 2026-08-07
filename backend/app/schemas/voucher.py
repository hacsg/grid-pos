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
    amount: Money | None = Field(default=None)


class VoucherRead(TimestampSchema):
    """Voucher response payload."""

    code: str
    type: VoucherType
    amount: Money | None = None
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
    customer_name: str | None = None
    customer_phone: str | None = None
    campaign_name: str | None = None
    campaign_code_prefix: str | None = None


class VoucherIssueRequest(BaseModel):
    """Issue a campaign voucher to one existing customer."""

    customer_id: UUID
    campaign_id: UUID
    discount_cents: int | None = Field(default=None, ge=0)


class VoucherBulkIssueRequest(BaseModel):
    """Bulk issue campaign vouchers to provided customers or all campaign signups."""

    campaign_id: UUID
    customer_ids: list[UUID] | None = None
    discount_cents: int | None = Field(default=None, ge=0)


class VoucherBulkIssueResponse(BaseModel):
    """Summary of bulk issued vouchers."""

    issued: int
    codes: list[str]


class VoucherValidateRequest(BaseModel):
    """Request body for validating a voucher code before applying."""

    code: str = Field(min_length=1, max_length=64)


class VoucherValidateRead(BaseModel):
    """Response for a successful validation (voucher is available).

    ``id`` is a plain string: Plotholders is the source of truth and its
    voucher ids are not guaranteed to be UUIDs (the router even falls back to
    the code itself when the upstream record has no id).
    """

    id: str
    code: str
    type: VoucherType
    amount: Money | None = None
    is_valid: bool = True
    kind: str | None = None  # free_item | amount_off | percent_off
    source: str | None = None  # gift | birthday | tier | ...
    status: str | None = None  # active | inactive | redeemed | ...
    is_gift_card: bool = False  # source == 'gift'


class GiftCardActivateRequest(BaseModel):
    """Activate a physical gift card at the till after payment."""

    code: str = Field(min_length=1, max_length=64)


class GiftCardActivateRead(BaseModel):
    """Activated gift card returned to the POS."""

    code: str
    amount: Money
    status: str
    expires_at: datetime | None = None


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
    campaign_id: UUID | None = None
    outlet_id: UUID | None = None
    order_id: UUID | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
