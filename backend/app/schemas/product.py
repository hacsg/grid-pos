"""Product request and response schemas."""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.category import CategoryRead
from app.schemas.common import Money, TimestampSchema
from app.schemas.modifier import ProductModifierAssignmentRead


class ProductBase(BaseModel):
    """Shared product fields."""

    name: str = Field(min_length=1, max_length=160)
    price: Money
    category_id: UUID
    image_url: str | None = Field(default=None, max_length=500)
    is_available: bool = True


class ProductCreate(ProductBase):
    """Payload for creating a product."""


class ProductUpdate(BaseModel):
    """Payload for updating a product."""

    name: str | None = Field(default=None, min_length=1, max_length=160)
    price: Money | None = None
    category_id: UUID | None = None
    image_url: str | None = Field(default=None, max_length=500)
    is_available: bool | None = None


class ProductRead(ProductBase, TimestampSchema):
    """Product response payload."""


class ProductDetailRead(ProductRead):
    """Product response payload with category and assigned modifier groups."""

    category: CategoryRead
    modifier_groups: list[ProductModifierAssignmentRead] = []


class ProductAvailabilityUpdate(BaseModel):
    """Payload for toggling product availability."""

    is_available: bool

