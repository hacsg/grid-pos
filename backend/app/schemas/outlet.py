"""Outlet request and response schemas."""

from uuid import UUID

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

    paynow_qr_url: str | None = None
    logo_url: str | None = None


class PayNowQrRead(BaseModel):
    """Current PayNow QR data URL for an outlet."""

    outlet_id: UUID
    paynow_qr_url: str | None = None


class OutletLogoRead(BaseModel):
    """Current shop logo data URL for an outlet (shown on the customer display)."""

    outlet_id: UUID
    logo_url: str | None = None
