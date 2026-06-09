"""Modifier group, option, and assignment schemas."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import Money, TimestampSchema, UUIDSchema


class ModifierOptionBase(BaseModel):
    """Shared modifier option fields."""

    name: str = Field(min_length=1, max_length=120)
    price_adjustment: Money = Decimal("0.00")
    display_order: int = Field(default=0, ge=0)
    is_available: bool = True


class ModifierOptionCreate(ModifierOptionBase):
    """Payload for creating an option within a group."""

    pass


class ModifierOptionUpdate(BaseModel):
    """Payload for updating a modifier option."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    price_adjustment: Money | None = None
    display_order: int | None = Field(default=None, ge=0)
    is_available: bool | None = None


class ModifierOptionRead(UUIDSchema):
    """Modifier option response payload."""

    name: str
    price_adjustment: Money
    display_order: int
    is_available: bool
    created_at: datetime


class ModifierGroupBase(BaseModel):
    """Shared modifier group fields."""

    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    sort_order: int = Field(default=0, ge=0)


class ModifierGroupCreate(ModifierGroupBase):
    """Payload for creating a modifier group."""

    pass


class ModifierGroupUpdate(BaseModel):
    """Payload for updating a modifier group."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class ModifierGroupRead(TimestampSchema, ModifierGroupBase):
    """Modifier group response with nested options."""

    options: list[ModifierOptionRead] = []


class ModifierGroupReorderItem(BaseModel):
    """Single item in a modifier group reorder request."""

    id: UUID
    sort_order: int = Field(ge=0)


class ModifierGroupReorder(BaseModel):
    """Payload for reordering multiple modifier groups."""

    items: list[ModifierGroupReorderItem]


class ProductModifierAssignmentCreate(BaseModel):
    """Payload for assigning a modifier group to a product."""

    group_id: UUID
    min_select: int = Field(default=1, ge=0)
    max_select: int = Field(default=1, ge=1)
    is_required: bool = False
    display_order: int = Field(default=0, ge=0)


class ProductModifierAssignmentUpdate(BaseModel):
    """Payload for updating a product-group assignment."""

    min_select: int | None = Field(default=None, ge=0)
    max_select: int | None = Field(default=None, ge=1)
    is_required: bool | None = None
    display_order: int | None = Field(default=None, ge=0)


class ProductModifierAssignmentRead(UUIDSchema):
    """Assignment of a modifier group to a product, with nested group/options."""

    group_id: UUID
    group_name: str
    group_description: str | None = None
    min_select: int
    max_select: int
    is_required: bool
    display_order: int
    options: list[ModifierOptionRead] = []