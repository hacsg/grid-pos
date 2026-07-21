"""Print template schemas."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel, TimestampSchema


class PrintTemplateBase(BaseModel):
    """Shared print template payload fields."""

    outlet_id: UUID | None = None
    document_type: str = Field(pattern="^(receipt|kitchen_chit)$")
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = False
    config: dict[str, Any]


class PrintTemplateCreate(PrintTemplateBase):
    """Create payload."""


class PrintTemplateUpdate(BaseModel):
    """Update payload."""

    outlet_id: UUID | None = None
    document_type: str | None = Field(default=None, pattern="^(receipt|kitchen_chit)$")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    config: dict[str, Any] | None = None


class PrintTemplateRead(PrintTemplateBase, TimestampSchema):
    """Read payload."""


class PrintTemplateSeedRequest(BaseModel):
    """Seed defaults for an outlet or global fallback."""

    outlet_id: UUID | None = None


class PrintTemplatePreviewRequest(BaseModel):
    """Preview payload for a stored template."""

    order_data: dict[str, Any] | None = None


class PrintTemplatePreviewResponse(ORMModel):
    """Rendered preview text."""

    text: str
