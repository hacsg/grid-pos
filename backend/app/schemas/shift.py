"""Shift / clock-in-out Pydantic schemas."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from app.schemas.common import Money, ORMModel, UUIDSchema


class ShiftRead(UUIDSchema):
    """Shift response payload."""

    staff_id: UUID
    outlet_id: UUID
    clock_in: datetime
    clock_out: datetime | None = None
    orders_processed: int | None = 0
    total_sales: Decimal | None = Field(default=Decimal("0.00"), max_digits=10, decimal_places=2)
    expected_cash: Money | None = None
    actual_cash: Money | None = None
    created_at: datetime


class ClockInResponse(ORMModel):
    """Response returned after a successful clock-in."""

    shift_id: UUID
    staff_id: UUID
    clock_in: datetime
    message: str = "Clocked in successfully"


class ClockOutResponse(ORMModel):
    """Response returned after a successful clock-out."""

    shift_id: UUID
    staff_id: UUID
    clock_in: datetime
    clock_out: datetime
    duration_minutes: int
    orders_processed: int
    total_sales: Decimal
    message: str = "Clocked out successfully"


class ShiftCloseRequest(ORMModel):
    """Payload for closing a shift with counted drawer cash."""

    actual_cash: Money = Field(..., ge=0)


class ShiftSummary(ORMModel):
    """Shift duration display helper."""

    is_clocked_in: bool
    shift_id: UUID | None = None
    clock_in: datetime | None = None
    duration_minutes: int | None = None
    orders_processed: int | None = 0
    total_sales: Decimal | None = Field(default=Decimal("0.00"), max_digits=10, decimal_places=2)
