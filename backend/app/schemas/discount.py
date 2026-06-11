"""Discount request and response schemas."""
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import TimestampSchema


class DiscountBase(BaseModel):
    """Shared discount fields."""

    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="percent", pattern="^(percent|fixed)$")
    amount: float = Field(ge=0)
    is_active: bool = True
    outlet_id: UUID | None = None
    sort_order: int = Field(default=0, ge=0)


class DiscountCreate(DiscountBase):
    """Payload for creating a discount."""


class DiscountUpdate(BaseModel):
    """Payload for updating a discount (all fields optional)."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: str | None = Field(default=None, pattern="^(percent|fixed)$")
    amount: float | None = Field(default=None, ge=0)
    is_active: bool | None = None
    outlet_id: UUID | None = None
    sort_order: int | None = Field(default=None, ge=0)


class DiscountRead(DiscountBase, TimestampSchema):
    """Discount response payload."""
