"""Customer request and response schemas."""

from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.campaign import CampaignSummary
from app.schemas.common import UUIDSchema


class CustomerCreate(BaseModel):
    """Payload for creating an Acre Club / Plotholders customer."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str = Field(min_length=6, max_length=20)
    email: str | None = Field(default=None, max_length=255)
    tier: str = Field(default="bronze", max_length=20)
    moments_total: int = Field(default=0, ge=0)
    campaign_code: str | None = Field(default=None, min_length=1, max_length=64)


class CustomerRead(UUIDSchema):
    """Customer response payload."""

    name: str | None = None
    phone: str
    email: str | None = None
    tier: str
    moments_total: int
    signup_campaign_id: UUID | None = None
    signup_campaign: CampaignSummary | None = None


class IssuedVoucherSummary(UUIDSchema):
    """Compact voucher response for signup issuance."""

    code: str
    discount_cents: int | None = None
    status: str
    campaign_id: UUID | None = None
    customer_id: UUID | None = None


class CustomerSignupResponse(CustomerRead):
    """Customer signup response with optional auto-issued voucher."""

    auto_issued_voucher: IssuedVoucherSummary | None = None
