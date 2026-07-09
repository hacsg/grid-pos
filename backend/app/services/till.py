"""Till session service — open/close a cash drawer per outlet per business day."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order, OrderStatus
from app.models.till_movement import TillMovement
from app.models.till_session import TillSession
from app.services.orders import SGT_TZ, business_day_bounds

_CENT = Decimal("0.01")


def _q(v: Decimal) -> Decimal:
    return v.quantize(_CENT, rounding=ROUND_HALF_UP)


async def get_open_till(db: AsyncSession, outlet_id: UUID) -> TillSession | None:
    return await db.scalar(
        select(TillSession).where(
            TillSession.outlet_id == outlet_id, TillSession.status == "open"
        )
    )


async def cash_kept_today(db: AsyncSession, outlet_id: UUID, since: datetime) -> Decimal:
    """Net cash added to the drawer for the outlet's current business day.

    Per paid order: split → cash leg; otherwise cash_tendered − cash_change
    (the cash actually retained). PayNow/card contribute nothing.
    """
    day_start, day_end = business_day_bounds()
    if since.tzinfo is None:
        since = since.replace(tzinfo=UTC)
    start = max(day_start, since)
    stmt = select(
        func.coalesce(
            func.sum(
                case(
                    (Order.payment_method == "split", func.coalesce(Order.cash_amount, 0)),
                    else_=func.coalesce(Order.cash_tendered, 0) - func.coalesce(Order.cash_change, 0),
                )
            ),
            0,
        )
    ).where(
        Order.outlet_id == outlet_id,
        Order.created_at >= start,
        Order.created_at < day_end,
        Order.payment_method.in_(("cash", "split")),
        Order.status == OrderStatus.paid,
    )
    return _q(Decimal(str(await db.scalar(stmt) or 0)))


async def open_till(
    db: AsyncSession, outlet_id: UUID, opening_float: Decimal, staff_id: UUID
) -> TillSession:
    existing = await get_open_till(db, outlet_id)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A till is already open for this outlet")
    business_date = datetime.now(SGT_TZ).date()
    session = TillSession(
        outlet_id=outlet_id,
        business_date=business_date,
        status="open",
        opening_float=_q(opening_float),
        opened_by_staff_id=staff_id,
    )
    db.add(session)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A till is already open for this outlet")
    await db.refresh(session)
    return session


async def movement_totals(db: AsyncSession, session_id: UUID) -> tuple[Decimal, Decimal]:
    """Return (cash_in, cash_out) totals recorded on a till session."""
    stmt = select(
        func.coalesce(func.sum(case((TillMovement.direction == "in", TillMovement.amount), else_=0)), 0),
        func.coalesce(func.sum(case((TillMovement.direction == "out", TillMovement.amount), else_=0)), 0),
    ).where(TillMovement.till_session_id == session_id)
    row = (await db.execute(stmt)).one()
    return _q(Decimal(str(row[0] or 0))), _q(Decimal(str(row[1] or 0)))


async def expected_cash_now(db: AsyncSession, session: TillSession) -> Decimal:
    """Live expected drawer cash: float + cash kept + cash in − cash out."""
    cash = await cash_kept_today(db, session.outlet_id, session.opened_at)
    cash_in, cash_out = await movement_totals(db, session.id)
    return _q(Decimal(str(session.opening_float)) + cash + cash_in - cash_out)


async def record_movement(
    db: AsyncSession,
    session: TillSession,
    *,
    direction: str,
    amount: Decimal,
    reason: str | None,
    staff_id: UUID,
    authorized_by_staff_id: UUID,
) -> TillMovement:
    if direction not in ("in", "out", "nosale"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid movement direction")
    mv = TillMovement(
        till_session_id=session.id,
        direction=direction,
        amount=_q(amount) if direction != "nosale" else Decimal("0.00"),
        reason=reason,
        staff_id=staff_id,
        authorized_by_staff_id=authorized_by_staff_id,
    )
    db.add(mv)
    await db.commit()
    await db.refresh(mv)
    return mv


async def list_movements(db: AsyncSession, session_id: UUID) -> list[TillMovement]:
    result = await db.execute(
        select(TillMovement).where(TillMovement.till_session_id == session_id).order_by(TillMovement.created_at)
    )
    return list(result.scalars().all())


async def close_till(
    db: AsyncSession, session_id: UUID, counted_cash: Decimal, staff_id: UUID
) -> TillSession:
    """Blind close: records the counted cash and computes expected + variance.
    The caller decides what to reveal (variance is manager-only)."""
    session = await db.get(TillSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Till session not found")
    if session.status != "open":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Till is already closed")

    expected = await expected_cash_now(db, session)
    counted = _q(counted_cash)
    session.counted_cash = counted
    session.expected_cash = expected
    session.variance = _q(counted - expected)
    session.closed_by_staff_id = staff_id
    session.closed_at = datetime.now(UTC)
    session.status = "closed"
    await db.commit()
    await db.refresh(session)
    return session


async def list_sessions(db: AsyncSession, outlet_id: UUID, limit: int = 60) -> list[TillSession]:
    result = await db.execute(
        select(TillSession)
        .where(TillSession.outlet_id == outlet_id)
        .order_by(TillSession.business_date.desc(), TillSession.opened_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
