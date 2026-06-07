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
    """Payload for updating a staff member."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    pin: str | None = Field(default=None, pattern=r"^\d{4}$")
    role: StaffRole | None = None
    outlet_id: UUID | None = None
    is_active: bool | None = None


class StaffLogin(BaseModel):
    """Payload for staff PIN login."""

    outlet_id: UUID
    name: str = Field(min_length=1, max_length=120)
    pin: str = Field(pattern=r"^\d{4}$")


class StaffRead(StaffBase, TimestampSchema):
    """Staff response payload without PIN hash."""


class TokenRead(BaseModel):
    """Bearer token response payload."""

    access_token: str
    token_type: str = "bearer"
    staff: StaffRead

