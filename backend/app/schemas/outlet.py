"""Outlet request and response schemas."""

from pydantic import BaseModel, Field

from app.schemas.common import TimestampSchema


class OutletBase(BaseModel):
    """Shared outlet fields."""

    name: str = Field(min_length=1, max_length=120)
    address: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=40)


class OutletCreate(OutletBase):
    """Payload for creating an outlet."""


class OutletUpdate(BaseModel):
    """Payload for updating an outlet."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=40)


class OutletRead(OutletBase, TimestampSchema):
    """Outlet response payload."""

