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
from app.services.forecast import calculate_month_end_prediction

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


@pytest.mark.asyncio
async def test_forecast_result_breaks_down_current_and_target_by_visible_outlet(db_session):
    current = date(2026, 9, 10)
    first, first_staff = await _add_outlet(db_session, name="First")
    second, second_staff = await _add_outlet(db_session, name="Second")
    hidden, _ = await _add_outlet(db_session, name="Bedok", hidden=True)
    for outlet in (first, second, hidden):
        await _add_history(db_session, outlet.id, date(2026, 9, 1), "100.00")

    await _add_order(
        db_session,
        first,
        first_staff,
        datetime(2026, 9, 9, 12, tzinfo=SGT),
        "100.00",
        "first-order",
    )
    await _add_order(
        db_session,
        second,
        second_staff,
        datetime(2026, 9, 9, 12, tzinfo=SGT),
        "200.00",
        "second-order",
    )

    result = await calculate_month_end_prediction(db_session, None, current)

    assert [item.outlet_name for item in result.outlets] == ["First", "Second"]
    assert [item.earned_so_far for item in result.outlets] == [100.0, 200.0]
    assert all(item.projected_total >= item.earned_so_far for item in result.outlets)
    assert result.projected_total == pytest.approx(
        sum(item.projected_total for item in result.outlets)
    )


@pytest.mark.asyncio
async def test_current_month_qashier_days_count_as_earned_before_grid_cutover(db_session):
    """Pre-cutover Qashier days in the current month are counted as earned.

    Tampines moved to Grid mid-month; the earlier days of the month were still
    on Qashier. Those imported daily totals must count toward month-to-date
    earned (and thus the projection), and a real historical value must win over
    a same-day S$0.01 Grid cert test order.
    """
    current = date(2026, 9, 20)
    outlet, staff = await _add_outlet(db_session, name="Tampines")

    # Imported Qashier days for the current month (pre-cutover).
    for day, amount in [(1, "677.70"), (2, "829.30"), (3, "966.50")]:
        db_session.add(HistoricalDailySale(
            id=uuid4(),
            outlet_id=outlet.id,
            sales_date=date(2026, 9, day),
            net_sales=Decimal(amount),
            transaction_count=50,
            source="qashier",
            source_ref=f"q-{day}",
        ))
    await db_session.commit()

    # A S$0.01 cert test order on Sept 1 (same day as a real Qashier report).
    await _add_order(db_session, outlet, staff, datetime(2026, 9, 1, 9, tzinfo=SGT), "0.01", "cert")
    # Real Grid trading after cutover, including today (partial).
    await _add_order(db_session, outlet, staff, datetime(2026, 9, 15, 12, tzinfo=SGT), "500.00", "g15")
    await _add_order(db_session, outlet, staff, datetime(2026, 9, 20, 10, tzinfo=SGT), "50.00", "g20")

    result = await calculate_month_end_prediction(db_session, outlet.id, current)

    # earned = Qashier 1-3 (real value wins over cert) + Grid 15 + Grid 20 today.
    assert result.earned_so_far == pytest.approx(677.70 + 829.30 + 966.50 + 500.00 + 50.00)
    assert result.outlets[0].earned_so_far == pytest.approx(result.earned_so_far)
    assert result.projected_total >= result.earned_so_far


@pytest.mark.asyncio
async def test_pace_variance_flags_outlets_ahead_and_behind(db_session):
    """Each outlet (and the group) reports actual-vs-expected pace as +/- %."""
    current = date(2026, 9, 11)  # 10 completed days this month
    ahead, ahead_staff = await _add_outlet(db_session, name="Ahead")
    behind, behind_staff = await _add_outlet(db_session, name="Behind")
    # Both have a flat ~100/day weekday+weekend history baseline.
    for outlet in (ahead, behind):
        await _add_history(db_session, outlet.id, date(2026, 9, 1), "100.00")

    # Ahead outlet trades 150/day on completed days (ahead of ~100 expectation);
    # Behind outlet trades 60/day (below expectation).
    for offset in range(10):
        await _add_order(db_session, ahead, ahead_staff,
                         datetime(2026, 9, 1, 12, tzinfo=SGT) + timedelta(days=offset),
                         "150.00", f"a{offset}")
        await _add_order(db_session, behind, behind_staff,
                         datetime(2026, 9, 1, 12, tzinfo=SGT) + timedelta(days=offset),
                         "60.00", f"b{offset}")

    result = await calculate_month_end_prediction(db_session, None, current)
    by_name = {o.outlet_name: o for o in result.outlets}

    assert by_name["Ahead"].pace_variance_pct is not None
    assert by_name["Ahead"].pace_variance_pct > 0
    assert by_name["Behind"].pace_variance_pct < 0
    # Group is the blend of both: net positive here (150+60 vs 100+100 = +5%).
    assert result.pace_variance_pct == pytest.approx(5.0, abs=0.5)
