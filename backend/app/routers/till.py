"""Till (cash drawer) endpoints — open with a float, blind-close, manager review."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import get_db
from app.models.staff import Staff
from app.models.till_session import TillSession
from app.services import till as till_service
from app.utils.auth import get_current_staff
from app.utils.hashing import verify_pin
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/till", tags=["till"])

_MANAGER_ROLES = {"admin", "manager", "supervisor"}


def _is_manager(staff: Staff) -> bool:
    return str(getattr(staff.role, "value", staff.role)) in _MANAGER_ROLES


async def _authorize_manager(db: AsyncSession, current_staff: Staff, manager_pin: str | None) -> Staff:
    """Return the authorizing manager: the current staff if already a manager,
    otherwise a manager at the outlet matching the PIN. A cashier's own PIN
    cannot authorize."""
    if _is_manager(current_staff):
        return current_staff
    if not manager_pin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager PIN required")
    result = await db.execute(
        select(Staff).where(Staff.outlet_id == current_staff.outlet_id, Staff.is_active.is_(True))
    )
    for staff in result.scalars().all():
        if _is_manager(staff) and verify_pin(manager_pin, staff.pin_hash):
            return staff
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid manager PIN")


# Blind view — what the counting cashier sees. No expected/variance for the
# close count; the opening expectation is deliberately visible (it is the
# handover figure the cashier verifies against).
class TillRead(BaseModel):
    id: UUID
    outlet_id: UUID
    business_date: date
    status: str
    opening_float: Decimal
    expected_opening_float: Decimal | None = None
    opening_variance: Decimal | None = None
    opened_at: datetime
    counted_cash: Decimal | None = None
    closed_at: datetime | None = None


# Manager view — adds the reconciliation figures.
class TillManagerRead(TillRead):
    expected_cash: Decimal | None = None
    variance: Decimal | None = None
    opened_by_staff_id: UUID | None = None
    closed_by_staff_id: UUID | None = None


class OpenTillRequest(BaseModel):
    outlet_id: UUID
    opening_float: Decimal = Field(ge=0)


class CarryOverRead(BaseModel):
    """What the drawer should hold before the next open, per the last close."""

    expected_opening_float: Decimal | None = None
    previous_business_date: date | None = None
    previous_counted_cash: Decimal | None = None
    previous_closed_at: datetime | None = None


class CloseTillRequest(BaseModel):
    session_id: UUID
    counted_cash: Decimal = Field(ge=0)


def _blind(s: TillSession) -> TillRead:
    return TillRead.model_validate(s, from_attributes=True)


def _full(s: TillSession) -> TillManagerRead:
    return TillManagerRead.model_validate(s, from_attributes=True)


@router.get("/current", response_model=TillManagerRead | None)
async def current_till(
    outlet_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> TillManagerRead | None:
    """The open till for an outlet, or null. Managers get the live expected
    figure; cashiers get only the blind fields."""
    session = await till_service.get_open_till(db, outlet_id)
    if session is None:
        return None
    if _is_manager(current_staff):
        full = _full(session)
        full.expected_cash = await till_service.expected_cash_now(db, session)
        return full
    return _full(session).model_copy(update={"expected_cash": None, "variance": None})


@router.get("/carry-over", response_model=CarryOverRead)
async def carry_over(
    outlet_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> CarryOverRead:
    """Cash expected in the drawer at the next open — the previous close's
    counted cash, assuming no overnight cash-out/in. Used to prefill the
    opening-float step and surface an opening variance."""
    previous, expected = await till_service.carry_over_float(db, outlet_id)
    if previous is None:
        return CarryOverRead()
    return CarryOverRead(
        expected_opening_float=expected,
        previous_business_date=previous.business_date,
        previous_counted_cash=previous.counted_cash,
        previous_closed_at=previous.closed_at,
    )


@router.post("/open", response_model=TillRead)
async def open_till(
    payload: OpenTillRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> TillRead:
    session = await till_service.open_till(
        db, payload.outlet_id, payload.opening_float, current_staff.id
    )
    return _blind(session)


@router.post("/close", response_model=TillRead)
async def close_till(
    payload: CloseTillRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> TillRead:
    """Blind close: the response deliberately omits expected/variance so the
    counting cashier cannot see whether they are over or short."""
    session = await till_service.close_till(
        db, payload.session_id, payload.counted_cash, current_staff.id
    )
    return _blind(session)


@router.get("/sessions", response_model=list[TillManagerRead])
async def list_sessions(
    outlet_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[TillManagerRead]:
    """Manager-only: till history with expected cash and variance."""
    if not _is_manager(current_staff):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager access required")
    sessions = await till_service.list_sessions(db, outlet_id)
    return [_full(s) for s in sessions]


class TillMovementRequest(BaseModel):
    session_id: UUID
    direction: str  # in | out
    amount: Decimal = Field(gt=0)
    reason: str | None = Field(default=None, max_length=200)
    manager_pin: str | None = None


class TillMovementRead(BaseModel):
    id: UUID
    direction: str
    amount: Decimal
    reason: str | None = None
    created_at: datetime


class DrawerOpenRequest(BaseModel):
    outlet_id: UUID
    reason: str | None = Field(default=None, max_length=200)
    manager_pin: str | None = None


@router.post("/movement", response_model=TillMovementRead)
async def add_movement(
    payload: TillMovementRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> TillMovementRead:
    """Record a cash-in (float top-up) or cash-out (paid-out / drop). These
    adjust the expected drawer cash at close. Manager-authorized."""
    if payload.direction not in ("in", "out"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="direction must be 'in' or 'out'")
    session = await db.get(TillSession, payload.session_id)
    if session is None or session.status != "open":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No open till session")
    manager = await _authorize_manager(db, current_staff, payload.manager_pin)
    mv = await till_service.record_movement(
        db, session,
        direction=payload.direction, amount=payload.amount, reason=payload.reason,
        staff_id=current_staff.id, authorized_by_staff_id=manager.id,
    )
    return TillMovementRead.model_validate(mv, from_attributes=True)


@router.post("/drawer-open")
async def drawer_open(
    payload: DrawerOpenRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> dict:
    """Authorize a no-sale drawer open with a manager PIN. Logs it against the
    open till (if any) for audit; the POS pulses the physical drawer on success."""
    manager = await _authorize_manager(db, current_staff, payload.manager_pin)
    session = await till_service.get_open_till(db, payload.outlet_id)
    if session is not None:
        await till_service.record_movement(
            db, session, direction="nosale", amount=Decimal("0"),
            reason=payload.reason or "Drawer opened", staff_id=current_staff.id,
            authorized_by_staff_id=manager.id,
        )
    return {"ok": True}


@router.get("/{session_id}/movements", response_model=list[TillMovementRead])
async def session_movements(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[TillMovementRead]:
    """Manager-only: the cash movements recorded on a till session."""
    if not _is_manager(current_staff):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager access required")
    movements = await till_service.list_movements(db, session_id)
    return [TillMovementRead.model_validate(m, from_attributes=True) for m in movements]
