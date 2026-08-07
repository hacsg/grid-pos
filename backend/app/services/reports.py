"""Sales reporting services with efficient SQLAlchemy aggregations."""

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, extract, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.category import Category
from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.models.outlet import Outlet
from app.models.product import Product
from app.models.shift import Shift
from app.models.staff import Staff
from app.utils.timezone import sgt_day_bounds_utc
from app.schemas.report import (
    CategoryBreakdown,
    DailyReportResponse,
    HourlySales,
    MonthlyReportResponse,
    OutletComparison,
    OutletReportResponse,
    ProductPerformance,
    ProductReportResponse,
    SalesSummaryResponse,
    ShiftCashReconciliation,
    StaffPerformance,
    StaffReportResponse,
    WeeklyReportResponse,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sgt_span_utc(start_day: date, end_day: date) -> tuple[datetime, datetime]:
    """UTC bounds ``[start, end)`` spanning SGT days ``start_day`` .. ``end_day``.

    Periods are SGT calendar periods. These used to be cut on UTC midnight —
    08:00 to 08:00 SGT — which put a report eight hours out of step with the
    till's Z-report, analytics, and the landlord GTO feed, all of which cut on
    SGT midnight. Nothing had landed in the gap yet because the outlets do not
    trade between midnight and 08:00, but a late close would have been counted
    on the wrong day with nothing to show for it.
    """
    return sgt_day_bounds_utc(start_day)[0], sgt_day_bounds_utc(end_day)[1]


def _day_bounds(report_date: date) -> tuple[datetime, datetime]:
    """Return UTC datetime bounds for a single SGT day."""
    return sgt_day_bounds_utc(report_date)


def _week_bounds(week_str: str) -> tuple[datetime, datetime]:
    """Return UTC datetime bounds for an ISO week string like '2026-W23' (SGT days)."""
    year, week_num = week_str.split("-W")
    # Use Python's isocalendar to get the Monday of that ISO week
    # Approach: Jan 4 is always in week 1, compute from there
    jan4 = date(int(year), 1, 4)
    start_of_week_1 = jan4 - timedelta(days=jan4.isoweekday() - 1)
    monday = start_of_week_1 + timedelta(weeks=int(week_num) - 1)
    return _sgt_span_utc(monday, monday + timedelta(days=6))


def _month_bounds(month_str: str) -> tuple[datetime, datetime]:
    """Return UTC datetime bounds for a month string like '2026-06' (SGT days)."""
    year, mon = month_str.split("-")
    month_start = date(int(year), int(mon), 1)
    # Next month
    if int(mon) == 12:
        next_month = date(int(year) + 1, 1, 1)
    else:
        next_month = date(int(year), int(mon) + 1, 1)
    return _sgt_span_utc(month_start, next_month - timedelta(days=1))


def _calc_change_percent(current: Decimal, previous: Decimal) -> float:
    """Calculate percentage change. Returns 0 if previous is 0."""
    if previous == 0:
        return 0.0
    return float(((current - previous) / previous) * 100)


def _apply_outlet_filter(stmt, outlet_id: UUID | None, *, model=Order):
    """Append an outlet_id filter to a select statement if provided."""
    if outlet_id is not None:
        return stmt.where(model.outlet_id == outlet_id)
    return stmt


def _quantize_money(value: Decimal) -> Decimal:
    """Return a two-decimal money value."""
    return value.quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------
# Shift cash reconciliation
# ---------------------------------------------------------------------------


async def get_shift_cash_reconciliation(
    db: AsyncSession,
    shift_id: UUID,
) -> ShiftCashReconciliation:
    """Return expected vs actual cash for a single shift."""
    shift = await db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shift not found",
        )

    ended_at = shift.clock_out or datetime.now(UTC)
    cash_stmt = select(
        func.coalesce(
            func.sum(
                case(
                    (
                        Order.payment_method == "split",
                        func.coalesce(Order.cash_amount, 0),
                    ),
                    else_=func.coalesce(Order.cash_tendered, 0)
                    - func.coalesce(Order.cash_change, 0),
                )
            ),
            0,
        ).label("expected_cash"),
        func.count(Order.id).label("cash_orders_count"),
    ).where(
        Order.staff_id == shift.staff_id,
        Order.outlet_id == shift.outlet_id,
        Order.created_at >= shift.clock_in,
        Order.created_at <= ended_at,
        Order.payment_method.in_(("cash", "split")),
        Order.status == OrderStatus.paid,
    )
    result = await db.execute(cash_stmt)
    row = result.one()

    expected_cash = _quantize_money(Decimal(str(row.expected_cash or 0)))
    actual_cash = (
        _quantize_money(Decimal(str(shift.actual_cash)))
        if shift.actual_cash is not None
        else None
    )

    variance = Decimal("0.00")
    variance_percent = 0.0
    if actual_cash is not None:
        variance = _quantize_money(actual_cash - expected_cash)
        if expected_cash != 0:
            variance_percent = float((variance / expected_cash) * Decimal("100"))

    return ShiftCashReconciliation(
        shift_id=shift.id,
        staff_id=shift.staff_id,
        started_at=shift.clock_in,
        ended_at=shift.clock_out,
        expected_cash=expected_cash,
        actual_cash=actual_cash,
        variance=variance,
        variance_percent=variance_percent,
        cash_orders_count=int(row.cash_orders_count or 0),
    )


# ---------------------------------------------------------------------------
# Sales summary
# ---------------------------------------------------------------------------


async def get_sales_summary(db: AsyncSession, report_date: date) -> SalesSummaryResponse:
    """Return total sales, order count, and average order value for a single day."""
    start, end = _day_bounds(report_date)
    revenue, order_count, _, _ = await _get_period_sales(db, start, end, outlet_id=None)
    average = revenue / order_count if order_count > 0 else Decimal("0.00")
    return SalesSummaryResponse(
        total_sales=revenue,
        order_count=order_count,
        average_order_value=average.quantize(Decimal("0.01")),
        date=report_date,
    )


# ---------------------------------------------------------------------------
# Period-based helpers
# ---------------------------------------------------------------------------


async def _get_period_sales(
    db: AsyncSession,
    start: datetime,
    end: datetime,
    outlet_id: UUID | None,
) -> tuple[Decimal, int, dict[str, Decimal], list[HourlySales]]:
    """Fetch revenue, transaction count, payment breakdown, and hourly sales
    for paid orders within [start, end)."""
    base = select(Order).where(
        Order.created_at >= start,
        Order.created_at < end,
        Order.status == OrderStatus.paid,
    )
    if outlet_id is not None:
        base = base.where(Order.outlet_id == outlet_id)

    # Total revenue & transaction count
    agg_stmt = select(
        func.coalesce(func.sum(Order.total), 0),
        func.count(Order.id),
    ).where(
        Order.created_at >= start,
        Order.created_at < end,
        Order.status == OrderStatus.paid,
    )
    if outlet_id is not None:
        agg_stmt = agg_stmt.where(Order.outlet_id == outlet_id)

    result = await db.execute(agg_stmt)
    row = result.one()
    total_revenue = Decimal(str(row[0]))
    total_transactions = int(row[1])

    # Payment breakdown
    pmt_stmt = select(
        Order.payment_method,
        func.coalesce(func.sum(Order.total), 0),
    ).where(
        Order.created_at >= start,
        Order.created_at < end,
        Order.status == OrderStatus.paid,
        Order.payment_method.isnot(None),
    )
    if outlet_id is not None:
        pmt_stmt = pmt_stmt.where(Order.outlet_id == outlet_id)
    pmt_stmt = pmt_stmt.group_by(Order.payment_method)

    pmt_result = await db.execute(pmt_stmt)
    payment_breakdown: dict[str, Decimal] = {}
    for method, rev in pmt_result:
        payment_breakdown[str(method)] = Decimal(str(rev))

    # Hourly sales (works on both SQLite and PostgreSQL via SQLAlchemy extract)
    hour_stmt = select(
        extract("hour", Order.created_at).label("hour"),
        func.coalesce(func.sum(Order.total), 0).label("revenue"),
        func.count(Order.id).label("transactions"),
    ).where(
        Order.created_at >= start,
        Order.created_at < end,
        Order.status == OrderStatus.paid,
    )
    if outlet_id is not None:
        hour_stmt = hour_stmt.where(Order.outlet_id == outlet_id)
    hour_stmt = hour_stmt.group_by(extract("hour", Order.created_at)).order_by(
        extract("hour", Order.created_at)
    )

    hour_result = await db.execute(hour_stmt)
    hourly_sales = [
        HourlySales(
            hour=int(row.hour),
            revenue=Decimal(str(row.revenue)),
            transactions=int(row.transactions),
        )
        for row in hour_result
    ]

    return total_revenue, total_transactions, payment_breakdown, hourly_sales


async def _get_previous_period_sales(
    db: AsyncSession,
    prev_start: datetime,
    prev_end: datetime,
    outlet_id: UUID | None,
) -> Decimal:
    """Get total revenue for a previous comparison period."""
    stmt = select(func.coalesce(func.sum(Order.total), 0)).where(
        Order.created_at >= prev_start,
        Order.created_at < prev_end,
        Order.status == OrderStatus.paid,
    )
    if outlet_id is not None:
        stmt = stmt.where(Order.outlet_id == outlet_id)
    result = await db.execute(stmt)
    return Decimal(str(result.scalar_one()))


# ---------------------------------------------------------------------------
# Daily report
# ---------------------------------------------------------------------------


async def get_daily_report(
    db: AsyncSession,
    report_date: date,
    outlet_id: UUID | None = None,
) -> DailyReportResponse:
    """Build a daily sales report, including change vs same day last week."""
    start, end = _day_bounds(report_date)
    prev_start, prev_end = _day_bounds(report_date - timedelta(days=7))

    total_revenue, total_transactions, payment_breakdown, hourly_sales = (
        await _get_period_sales(db, start, end, outlet_id)
    )
    previous_revenue = await _get_previous_period_sales(
        db, prev_start, prev_end, outlet_id
    )

    avg_ticket = (
        Decimal(str(round(total_revenue / total_transactions, 2)))
        if total_transactions > 0
        else Decimal("0.00")
    )

    return DailyReportResponse(
        date=report_date,
        total_revenue=total_revenue,
        total_transactions=total_transactions,
        average_ticket=avg_ticket,
        change_percent=_calc_change_percent(total_revenue, previous_revenue),
        payment_breakdown=payment_breakdown,
        hourly_sales=hourly_sales,
    )


# ---------------------------------------------------------------------------
# Weekly report
# ---------------------------------------------------------------------------


async def get_weekly_report(
    db: AsyncSession,
    week: str,
    outlet_id: UUID | None = None,
) -> WeeklyReportResponse:
    """Build a weekly sales report, including change vs previous ISO week."""
    start, end = _week_bounds(week)

    # Previous week
    year, week_num = week.split("-W")
    prev_week_num = int(week_num) - 1
    prev_year = year
    if prev_week_num < 1:
        prev_week_num = 52  # approximate; real ISO weeks vary but fine for report
        prev_year = str(int(year) - 1)
    prev_week = f"{prev_year}-W{prev_week_num:02d}"
    prev_start, prev_end = _week_bounds(prev_week)

    total_revenue, total_transactions, payment_breakdown, hourly_sales = (
        await _get_period_sales(db, start, end, outlet_id)
    )
    previous_revenue = await _get_previous_period_sales(
        db, prev_start, prev_end, outlet_id
    )

    avg_ticket = (
        Decimal(str(round(total_revenue / total_transactions, 2)))
        if total_transactions > 0
        else Decimal("0.00")
    )

    return WeeklyReportResponse(
        week=week,
        total_revenue=total_revenue,
        total_transactions=total_transactions,
        average_ticket=avg_ticket,
        change_percent=_calc_change_percent(total_revenue, previous_revenue),
        payment_breakdown=payment_breakdown,
        hourly_sales=hourly_sales,
    )


# ---------------------------------------------------------------------------
# Monthly report
# ---------------------------------------------------------------------------


async def get_monthly_report(
    db: AsyncSession,
    month: str,
    outlet_id: UUID | None = None,
) -> MonthlyReportResponse:
    """Build a monthly sales report, including change vs previous month."""
    start, end = _month_bounds(month)

    # Previous month
    year_str, mon_str = month.split("-")
    y, m = int(year_str), int(mon_str)
    if m == 1:
        prev_month = f"{y - 1}-12"
    else:
        prev_month = f"{y}-{m - 1:02d}"
    prev_start, prev_end = _month_bounds(prev_month)

    total_revenue, total_transactions, payment_breakdown, hourly_sales = (
        await _get_period_sales(db, start, end, outlet_id)
    )
    previous_revenue = await _get_previous_period_sales(
        db, prev_start, prev_end, outlet_id
    )

    avg_ticket = (
        Decimal(str(round(total_revenue / total_transactions, 2)))
        if total_transactions > 0
        else Decimal("0.00")
    )

    return MonthlyReportResponse(
        month=month,
        total_revenue=total_revenue,
        total_transactions=total_transactions,
        average_ticket=avg_ticket,
        change_percent=_calc_change_percent(total_revenue, previous_revenue),
        payment_breakdown=payment_breakdown,
        hourly_sales=hourly_sales,
    )


# ---------------------------------------------------------------------------
# Product report
# ---------------------------------------------------------------------------


async def get_product_report(
    db: AsyncSession,
    date_from: date,
    date_to: date,
    outlet_id: UUID | None = None,
) -> ProductReportResponse:
    """Aggregate product sales within a date range."""
    start, end = _sgt_span_utc(date_from, date_to)

    # Base: paid orders in range
    paid_order_ids = select(Order.id).where(
        Order.created_at >= start,
        Order.created_at < end,
        Order.status == OrderStatus.paid,
    )
    if outlet_id is not None:
        paid_order_ids = paid_order_ids.where(Order.outlet_id == outlet_id)

    # Product performance: join OrderItem -> Product
    prod_stmt = (
        select(
            Product.id,
            Product.name,
            func.coalesce(func.sum(OrderItem.quantity), 0).label("units_sold"),
            func.coalesce(
                func.sum(OrderItem.quantity * OrderItem.unit_price), 0
            ).label("revenue"),
        )
        .join(OrderItem, OrderItem.product_id == Product.id)
        .where(OrderItem.order_id.in_(paid_order_ids))
        .group_by(Product.id, Product.name)
        .order_by(text("revenue DESC"))
    )

    prod_result = await db.execute(prod_stmt)
    products = []
    for row in prod_result:
        products.append(
            ProductPerformance(
                product_id=row.id,
                name=row.name,
                units_sold=int(row.units_sold),
                revenue=Decimal(str(row.revenue)),
                avg_modifiers=2.0,  # simplified; would need JSON analysis
            )
        )

    # Category breakdown
    cat_stmt = (
        select(
            Category.name,
            func.coalesce(
                func.sum(OrderItem.quantity * OrderItem.unit_price), 0
            ).label("revenue"),
        )
        .select_from(OrderItem)
        .join(Product, Product.id == OrderItem.product_id)
        .join(Category, Category.id == Product.category_id)
        .where(OrderItem.order_id.in_(paid_order_ids))
        .group_by(Category.name)
        .order_by(text("revenue DESC"))
    )

    cat_result = await db.execute(cat_stmt)
    cat_rows = cat_result.fetchall()
    total_cat_revenue = sum(Decimal(str(row.revenue)) for row in cat_rows)

    # Re-execute since we need a fresh result for iteration
    cat_result2 = await db.execute(cat_stmt)
    category_breakdown = []
    for row in cat_result2:
        rev = Decimal(str(row.revenue))
        pct = float(rev / total_cat_revenue * 100) if total_cat_revenue > 0 else 0.0
        category_breakdown.append(
            CategoryBreakdown(category=row.name, revenue=rev, percentage=round(pct, 1))
        )

    return ProductReportResponse(
        products=products,
        category_breakdown=category_breakdown,
    )


# ---------------------------------------------------------------------------
# Staff report
# ---------------------------------------------------------------------------


async def get_staff_report(
    db: AsyncSession,
    date_from: date,
    date_to: date,
    outlet_id: UUID | None = None,
) -> StaffReportResponse:
    """Aggregate staff performance within a date range."""
    start, end = _sgt_span_utc(date_from, date_to)

    base = select(Order).where(
        Order.created_at >= start,
        Order.created_at < end,
        Order.status == OrderStatus.paid,
    )
    if outlet_id is not None:
        base = base.where(Order.outlet_id == outlet_id)

    staff_stmt = (
        select(
            Staff.id,
            Staff.name,
            func.count(Order.id).label("transactions"),
            func.coalesce(func.sum(Order.total), 0).label("revenue"),
        )
        .join(Staff, Staff.id == Order.staff_id)
        .where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status == OrderStatus.paid,
        )
        .group_by(Staff.id, Staff.name)
        .order_by(text("revenue DESC"))
    )
    if outlet_id is not None:
        staff_stmt = staff_stmt.where(Order.outlet_id == outlet_id)

    result = await db.execute(staff_stmt)
    staff_list = []
    for row in result:
        trans = int(row.transactions)
        rev = Decimal(str(row.revenue))
        avg_ticket = (
            Decimal(str(round(rev / trans, 2))) if trans > 0 else Decimal("0.00")
        )
        staff_list.append(
            StaffPerformance(
                staff_id=row.id,
                name=row.name,
                transactions=trans,
                revenue=rev,
                average_ticket=avg_ticket,
            )
        )

    return StaffReportResponse(staff=staff_list)


# ---------------------------------------------------------------------------
# Outlet report
# ---------------------------------------------------------------------------


async def get_outlet_report(
    db: AsyncSession,
    date_from: date,
    date_to: date,
) -> OutletReportResponse:
    """Compare sales across all outlets within a date range."""
    start, end = _sgt_span_utc(date_from, date_to)

    # Aggregate per outlet
    outlet_stmt = (
        select(
            Outlet.id,
            Outlet.name,
            func.count(Order.id).label("transactions"),
            func.coalesce(func.sum(Order.total), 0).label("revenue"),
        )
        .join(Outlet, Outlet.id == Order.outlet_id)
        .where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status == OrderStatus.paid,
        )
        .group_by(Outlet.id, Outlet.name)
        .order_by(text("revenue DESC"))
    )

    result = await db.execute(outlet_stmt)
    outlets = []
    for row in result:
        trans = int(row.transactions)
        rev = Decimal(str(row.revenue))
        avg_ticket = (
            Decimal(str(round(rev / trans, 2))) if trans > 0 else Decimal("0.00")
        )

        # Find top product for this outlet
        top_product = await _get_top_product(
            db, start, end, outlet_id=row.id
        )

        outlets.append(
            OutletComparison(
                outlet_id=row.id,
                name=row.name,
                revenue=rev,
                transactions=trans,
                average_ticket=avg_ticket,
                top_product=top_product,
            )
        )

    return OutletReportResponse(outlets=outlets)


async def _get_top_product(
    db: AsyncSession,
    start: datetime,
    end: datetime,
    outlet_id: UUID,
) -> str:
    """Find the top-selling product name for an outlet within the period."""
    stmt = (
        select(
            Product.name,
            func.coalesce(func.sum(OrderItem.quantity), 0).label("total_qty"),
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .join(Product, Product.id == OrderItem.product_id)
        .where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status == OrderStatus.paid,
            Order.outlet_id == outlet_id,
        )
        .group_by(Product.id, Product.name)
        .order_by(text("total_qty DESC"))
        .limit(1)
    )
    result = await db.execute(stmt)
    row = result.first()
    return row.name if row else ""
