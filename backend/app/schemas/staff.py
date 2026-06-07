"""Staff request and response schemas."""

from uuid import UUID

from pydantic import BaseModel, Field

from app.models.staff import StaffRole
from app.schemas.common import TimestampSchema


class StaffBase(BaseModel):
    """Shared staff fields."""

    name: str = Field(min_length=1, max_length=120)
    role: StaffRole
    outlet_id: UUID
    is_active: bool = True


class StaffCreate(StaffBase):
    """Payload for creating a staff member."""

    pin: str = Field(pattern=r"^\d{4}$")


class StaffUpdate(BaseModel):
    """Payload for updating a staff member (PIN updates forbidden here)."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: StaffRole | None = None
    outlet_id: UUID | None = None
    is_active: bool | None = None


class StaffLoginRequest(BaseModel):
    """Payload for staff PIN login (no name required — PIN + outlet identifies staff)."""

    pin: str = Field(pattern=r"^\d{4}$")
    outlet_id: UUID


class StaffRead(StaffBase, TimestampSchema):
    """Staff response payload without PIN hash."""


class TokenResponse(BaseModel):
    """Bearer token response with staff details and expiry."""

    access_token: str
    token_type: str = "bearer"
    staff: StaffRead
    expires_in: int = 3600


class TokenRefreshResponse(BaseModel):
    """Bearer token response for refresh endpoint."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600


class PinResetRequest(BaseModel):
    """Payload for resetting a staff member's PIN."""

    new_pin: str = Field(pattern=r"^\d{4}$")