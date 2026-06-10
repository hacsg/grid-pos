"""Category request and response schemas."""

from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import TimestampSchema


class CategoryBase(BaseModel):
    """Shared category fields."""

    name: str = Field(min_length=1, max_length=120)
    color: str | None = None
    sort_order: int = Field(default=0, ge=0)
    outlet_id: UUID | None = None


class CategoryCreate(CategoryBase):
    """Payload for creating a category."""


class CategoryUpdate(BaseModel):
    """Payload for updating a category."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = None
    sort_order: int | None = Field(default=None, ge=0)
    outlet_id: UUID | None = None


class CategoryReorderItem(BaseModel):
    """Single item in a reorder request."""

    id: UUID
    sort_order: int = Field(ge=0)


class CategoryReorder(BaseModel):
    """Payload for reordering multiple categories."""

    items: list[CategoryReorderItem]


class CategoryRead(CategoryBase, TimestampSchema):
    """Category response payload."""

