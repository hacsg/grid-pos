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
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/till", tags=["till"])

_MANAGER_ROLES = {"admin", "manager", "supervisor"}


def _is_manager(staff: Staff) -> bool:
    return str(getattr(staff.role, "value", staff.role)) in _MANAGER_ROLES


# Blind view — what the counting cashier sees. No expected/variance.
class TillRead(BaseModel):
    id: UUID
    outlet_id: UUID
    business_date: date
    status: str
    opening_float: Decimal
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
        cash = await till_service.cash_kept_today(db, outlet_id, session.opened_at)
        full = _full(session)
        full.expected_cash = (session.opening_float or Decimal("0")) + cash
        return full
    return _full(session).model_copy(update={"expected_cash": None, "variance": None})


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
