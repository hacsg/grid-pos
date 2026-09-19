"""Database-level tests for month-end forecast assembly."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.models.historical_daily_sale import HistoricalDailySale
from app.models.order import Order, OrderStatus
from app.models.outlet import Outlet
from app.models.staff import Staff, StaffRole
from app.services.analytics import month_end_prediction

SGT = ZoneInfo("Asia/Singapore")


async def _add_outlet(db_session, *, name: str, hidden: bool = False):
    outlet = Outlet(id=uuid4(), name=name, address="123 Test Street", is_hidden=hidden)
    staff = Staff(
        id=uuid4(),
        outlet_id=outlet.id,
        name=f"{name} Staff",
        pin_hash="test",
        role=StaffRole.cashier,
    )
    db_session.add_all([outlet, staff])
    await db_session.commit()
    return outlet, staff


async def _add_history(db_session, outlet_id, before: date, daily_sales: str = "100.00"):
    for offset in range(1, 71):
        sales_date = before - timedelta(days=offset)
        db_session.add(HistoricalDailySale(
            id=uuid4(),
            outlet_id=outlet_id,
            sales_date=sales_date,
            net_sales=Decimal(daily_sales),
            transaction_count=10,
            source="test-history",
            source_ref=f"{outlet_id}-{sales_date}",
        ))
    await db_session.commit()


async def _add_order(db_session, outlet, staff, created_at: datetime, amount: str, number: str):
    db_session.add(Order(
        id=uuid4(),
        order_number=number,
        outlet_id=outlet.id,
        staff_id=staff.id,
        subtotal=Decimal(amount),
        total=Decimal(amount),
        payment_method="cash",
        status=OrderStatus.paid,
        created_at=created_at,
    ))
    await db_session.commit()


@pytest.mark.asyncio
async def test_partial_current_day_changes_earned_but_not_remaining_forecast(db_session):
    current = date(2026, 9, 10)
    outlet, staff = await _add_outlet(db_session, name="Visible")
    await _add_history(db_session, outlet.id, current)
    month_start = datetime(2026, 9, 1, 12, tzinfo=SGT)
    for offset in range(9):
        await _add_order(
            db_session,
            outlet,
            staff,
            month_start + timedelta(days=offset),
            "100.00",
            f"completed-{offset}",
        )

    before = await month_end_prediction(db_session, outlet.id, current)
    await _add_order(
        db_session,
        outlet,
        staff,
        datetime(2026, 9, 10, 10, tzinfo=SGT),
        "10000.00",
        "partial-today",
    )
    after = await month_end_prediction(db_session, outlet.id, current)

    assert after[1] == before[1] + 10000.0
    assert after[2] == before[2]
    assert after[0] == before[0] + 10000.0
    assert after[0] >= after[1]


@pytest.mark.asyncio
async def test_all_outlets_forecast_excludes_hidden_outlets(db_session):
    current = date(2026, 9, 10)
    visible, visible_staff = await _add_outlet(db_session, name="Visible")
    hidden, hidden_staff = await _add_outlet(db_session, name="Bedok", hidden=True)
    await _add_history(db_session, visible.id, current, "100.00")
    await _add_history(db_session, hidden.id, current, "1000.00")

    await _add_order(
        db_session,
        visible,
        visible_staff,
        datetime(2026, 9, 9, 12, tzinfo=SGT),
        "100.00",
        "visible-order",
    )
    await _add_order(
        db_session,
        hidden,
        hidden_staff,
        datetime(2026, 9, 9, 12, tzinfo=SGT),
        "1000.00",
        "hidden-order",
    )

    all_visible = await month_end_prediction(db_session, None, current)
    visible_only = await month_end_prediction(db_session, visible.id, current)

    assert all_visible == visible_only
