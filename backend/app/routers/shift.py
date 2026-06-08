"""Shift / clock-in-out API routes.

Endpoints
---------
* ``POST /api/staff/{staff_id}/clock-in``  — start a new shift
* ``POST /api/staff/{staff_id}/clock-out`` — end the active shift
* ``GET /api/staff/{staff_id}/shifts``     — list recent shifts (latest first)
* ``GET /api/staff/{staff_id}/shifts/current`` — get active shift status
"""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.order import Order, OrderStatus
from app.models.shift import Shift
from app.models.staff import Staff
from app.schemas.shift import (
    ClockInResponse,
    ClockOutResponse,
    ShiftRead,
    ShiftSummary,
)
from app.utils.auth import get_current_staff

router = APIRouter(prefix="/staff", tags=["staff-shifts"])


async def _load_staff_or_404(db: AsyncSession, staff_id: str) -> Staff:
    """Load a staff member by id or raise a 404 response."""
    from uuid import UUID
    try:
        uid = UUID(staff_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid staff ID format",
        )
    staff = await db.get(Staff, uid)
    if staff is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found"
        )
    return staff


async def _get_active_shift(db: AsyncSession, staff_id: str) -> Shift | None:
    """Return the currently active (clock_out IS NULL) shift for a staff member, if any."""
    from uuid import UUID
    result = await db.execute(
        select(Shift).where(
            Shift.staff_id == UUID(staff_id),
            Shift.clock_out.is_(None),
        ).order_by(Shift.clock_in.desc()).limit(1)
    )
    return result.scalar_one_or_none()


@router.post("/{staff_id}/clock-in", response_model=ClockInResponse)
async def clock_in(
    staff_id: str,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ClockInResponse:
    """Start a new shift for the authenticated staff member.

    Fails with **409 Conflict** if the staff member already has an active
    (unfinished) shift.
    """
    staff = await _load_staff_or_404(db, staff_id)

    # Only allow clocking in as yourself
    if staff.id != current_staff.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only clock in for yourself",
        )

    # Check for existing active shift
    existing = await _get_active_shift(db, staff_id)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an active shift. Clock out first.",
        )

    now = datetime.now(timezone.utc)
    shift = Shift(
        staff_id=staff.id,
        outlet_id=staff.outlet_id,
        clock_in=now,
    )
    db.add(shift)
    await db.commit()
    await db.refresh(shift)

    return ClockInResponse(
        shift_id=shift.id,
        staff_id=shift.staff_id,
        clock_in=shift.clock_in,
    )


@router.post("/{staff_id}/clock-out", response_model=ClockOutResponse)
async def clock_out(
    staff_id: str,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ClockOutResponse:
    """End the active shift and compute summary stats.

    Calculates the number of orders processed and total sales during
    this shift by counting **paid** orders attributed to the staff
    member that were created between clock-in and clock-out.
    """
    staff = await _load_staff_or_404(db, staff_id)

    if staff.id != current_staff.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only clock out for yourself",
        )

    shift = await _get_active_shift(db, staff_id)
    if shift is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active shift found. Clock in first.",
        )

    now = datetime.now(timezone.utc)

    # Compute orders processed and total sales during this shift
    orders_result = await db.execute(
        select(
            func.count(Order.id),
            func.coalesce(func.sum(Order.total), 0),
        ).where(
            Order.staff_id == staff.id,
            Order.status == OrderStatus.paid,
            Order.created_at >= shift.clock_in,
            Order.created_at <= now,
        )
    )
    row = orders_result.one()
    orders_count = row[0] or 0
    sales_total = Decimal(str(row[1] or 0))

    # Calculate duration
    duration = (now - shift.clock_in).total_seconds() / 60
    duration_minutes = int(duration)

    shift.clock_out = now
    shift.orders_processed = int(orders_count)
    shift.total_sales = sales_total
    await db.commit()
    await db.refresh(shift)

    return ClockOutResponse(
        shift_id=shift.id,
        staff_id=shift.staff_id,
        clock_in=shift.clock_in,
        clock_out=shift.clock_out,
        duration_minutes=duration_minutes,
        orders_processed=shift.orders_processed or 0,
        total_sales=shift.total_sales or Decimal("0.00"),
    )


@router.get("/{staff_id}/shifts/current", response_model=ShiftSummary)
async def get_current_shift(
    staff_id: str,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ShiftSummary:
    """Return whether the staff member is currently clocked in and the active shift details."""
    await _load_staff_or_404(db, staff_id)

    shift = await _get_active_shift(db, staff_id)
    if shift is None:
        return ShiftSummary(is_clocked_in=False)

    duration = (datetime.now(timezone.utc) - shift.clock_in).total_seconds() / 60

    return ShiftSummary(
        is_clocked_in=True,
        shift_id=shift.id,
        clock_in=shift.clock_in,
        duration_minutes=int(duration),
    )


@router.get("/{staff_id}/shifts", response_model=list[ShiftRead])
async def list_shifts(
    staff_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[Shift]:
    """Return recent shifts for a staff member, most recent first."""
    from uuid import UUID
    await _load_staff_or_404(db, staff_id)

    result = await db.execute(
        select(Shift)
        .where(Shift.staff_id == UUID(staff_id))
        .order_by(Shift.clock_in.desc())
        .limit(limit)
    )
    return list(result.scalars().all())