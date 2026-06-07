"""Category request and response schemas."""

from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import TimestampSchema


class CategoryBase(BaseModel):
    """Shared category fields."""

    name: str = Field(min_length=1, max_length=120)
    sort_order: int = Field(default=0, ge=0)
    outlet_id: UUID | None = None


class CategoryCreate(CategoryBase):
    """Payload for creating a category."""


class CategoryUpdate(BaseModel):
    """Payload for updating a category."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = Field(default=None, ge=0)
    outlet_id: UUID | None = None


class CategoryRead(CategoryBase, TimestampSchema):
    """Category response payload."""

