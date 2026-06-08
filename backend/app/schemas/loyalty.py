"""Loyalty request and response schemas."""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class LoyaltyLookupRequest(BaseModel):
    """Payload for looking up a loyalty member by phone."""

    phone: str = Field(min_length=6, max_length=20)
    country_code: str = Field(default="+65", max_length=5)


class LoyaltyMemberProfile(BaseModel):
    """Loyalty member profile response."""

    member_id: UUID
    name: str
    phone: str
    country_code: str
    points: int
    points_value: Decimal
    tier: str


class LoyaltyLookupNotFound(BaseModel):
    """404 response when a member is not found."""

    detail: str = "Member not found"
    signup_available: bool = True


class LoyaltyEarnRequest(BaseModel):
    """Payload for earning points after payment."""

    member_id: UUID
    order_id: UUID
    amount_spent: Decimal = Field(gt=0)


class LoyaltyEarnResponse(BaseModel):
    """Response after earning points."""

    points_earned: int
    new_balance: int
    tier: str


class LoyaltyRedeemRequest(BaseModel):
    """Payload for redeeming points before payment."""

    member_id: UUID
    order_id: UUID
    points_to_redeem: int  # validated in service (min 100)


class LoyaltyRedeemResponse(BaseModel):
    """Response after redeeming points."""

    points_redeemed: int
    discount_amount: Decimal
    remaining_balance: int
    new_points: int


class LoyaltySignupRequest(BaseModel):
    """Payload for creating a new loyalty member."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str = Field(min_length=6, max_length=20)
    country_code: str = Field(default="+65", max_length=5)
    email: str | None = Field(default=None, max_length=255)
    birthday: str | None = Field(default=None, max_length=20)
    referred_by_code: str | None = Field(default=None, min_length=1, max_length=40)


class LoyaltySignupResponse(BaseModel):
    """Response after creating a new loyalty member."""

    member_id: UUID
    name: str
    phone: str
    country_code: str
    points: int = 0
    tier: str = "bronze"
