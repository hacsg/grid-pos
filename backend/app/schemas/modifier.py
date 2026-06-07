"""Modifier request and response schemas."""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import Money, TimestampSchema


class ModifierBase(BaseModel):
    """Shared modifier fields."""

    name: str = Field(min_length=1, max_length=120)
    price_adjustment: Money = Decimal("0.00")


class ModifierCreate(ModifierBase):
    """Payload for creating a modifier."""

    modifier_group_id: UUID


class ModifierUpdate(BaseModel):
    """Payload for updating a modifier."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    price_adjustment: Money | None = None


class ModifierRead(ModifierBase, TimestampSchema):
    """Modifier response payload."""

    modifier_group_id: UUID


class ModifierGroupBase(BaseModel):
    """Shared modifier group fields."""

    name: str = Field(min_length=1, max_length=120)
    required: bool = False
    min_select: int = Field(default=0, ge=0)
    max_select: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def validate_selection_bounds(self) -> "ModifierGroupBase":
        """Validate minimum and maximum selection bounds."""
        if self.min_select > self.max_select:
            raise ValueError("min_select cannot exceed max_select")
        if self.required and self.min_select == 0:
            raise ValueError("required modifier groups must have min_select greater than 0")
        return self


class ModifierGroupCreate(ModifierGroupBase):
    """Payload for creating a modifier group."""

    product_id: UUID


class ModifierGroupUpdate(BaseModel):
    """Payload for updating a modifier group."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    required: bool | None = None
    min_select: int | None = Field(default=None, ge=0)
    max_select: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_selection_bounds(self) -> "ModifierGroupUpdate":
        """Validate selection bounds when both values are supplied."""
        if self.min_select is not None and self.max_select is not None and self.min_select > self.max_select:
            raise ValueError("min_select cannot exceed max_select")
        if self.required is True and self.min_select == 0:
            raise ValueError("required modifier groups must have min_select greater than 0")
        return self


class ModifierGroupRead(ModifierGroupBase, TimestampSchema):
    """Modifier group response payload."""

    product_id: UUID
    modifiers: list[ModifierRead] = []

