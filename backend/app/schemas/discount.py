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
    # Targeting.
    scope: str = Field(default="cart", pattern="^(cart|targeted)$")
    min_quantity: int = Field(default=1, ge=1)
    threshold_mode: str = Field(default="gate", pattern="^(gate|bundle)$")
    target_category_ids: list[UUID] = Field(default_factory=list)
    target_product_ids: list[UUID] = Field(default_factory=list)


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
    scope: str | None = Field(default=None, pattern="^(cart|targeted)$")
    min_quantity: int | None = Field(default=None, ge=1)
    threshold_mode: str | None = Field(default=None, pattern="^(gate|bundle)$")
    target_category_ids: list[UUID] | None = None
    target_product_ids: list[UUID] | None = None


class DiscountRead(DiscountBase, TimestampSchema):
    """Discount response payload."""
