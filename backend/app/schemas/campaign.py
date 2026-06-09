"""Campaign request and response schemas."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel, UUIDSchema


class CampaignSummary(UUIDSchema):
    """Compact campaign reference for nested responses."""

    name: str
    channel: str | None = None
    code_prefix: str


class CampaignBase(BaseModel):
    """Shared campaign fields."""

    name: str = Field(min_length=1, max_length=120)
    channel: str | None = Field(default=None, max_length=80)
    code_prefix: str = Field(min_length=1, max_length=64)
    budget_cents: int | None = Field(default=None, ge=0)
    discount_cents: int = Field(default=0, ge=0)
    status: str = Field(default="draft", max_length=20)
    start_date: date | None = None
    end_date: date | None = None
    auto_issue_on_signup: bool = False
    signup_voucher_discount_cents: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_dates(self) -> "CampaignBase":
        """Ensure date ranges are coherent when both dates are provided."""
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class CampaignCreate(CampaignBase):
    """Payload for creating a campaign."""


class CampaignUpdate(BaseModel):
    """Payload for updating a campaign."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    channel: str | None = Field(default=None, max_length=80)
    code_prefix: str | None = Field(default=None, min_length=1, max_length=64)
    budget_cents: int | None = Field(default=None, ge=0)
    discount_cents: int | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, max_length=20)
    start_date: date | None = None
    end_date: date | None = None
    auto_issue_on_signup: bool | None = None
    signup_voucher_discount_cents: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_dates(self) -> "CampaignUpdate":
        """Ensure date ranges are coherent when both dates are provided."""
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class CampaignRead(CampaignBase, UUIDSchema):
    """Campaign response payload."""


class CampaignMetricsRead(ORMModel):
    """Campaign attribution and conversion metrics."""

    campaign_id: UUID
    campaign_name: str
    total_signups: int
    vouchers_auto_issued: int
    signup_purchase_conversions: int
    signup_purchase_conversion_rate: float
