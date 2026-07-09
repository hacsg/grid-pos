"""Sales analytics dashboard aggregates, computed live from orders.

Ports the Gusta sales-dashboard concept onto Grid's own order data: a flexible
date range (explicit from/to, rolling days, or all-time), headline KPIs with
percentage change vs the previous period, payment mix, per-outlet comparison,
a daily net-sales trend, top products, and pattern insights (day-of-week,
hour-of-day, menu concentration).

All calendar bucketing (days, weekdays, hours) is in Singapore time; orders
are stored in UTC.
"""

from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.models.outlet import Outlet
from app.schemas.analytics import (
    AnalyticsDashboardResponse,
    AnalyticsKpis,
    ConcentrationData,
    DayOfWeekPoint,
    HourlyPoint,
    OutletSalesItem,
    PaymentBreakdownItem,
    TopProductItem,
    TrendPoint,
)
from app.services.gto import SGT, sgt_day_bounds_utc

UTC = ZoneInfo("UTC")

# Display buckets for the payment-mix chart, in fixed order.
PAYMENT_BUCKETS = ("Cash", "Card", "PayNow", "Voucher", "Other")

_DAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


# ---------------------------------------------------------------------------
# Date-range helpers
# ---------------------------------------------------------------------------


def resolve_date_range(
    from_date: date | None,
    to_date: date | None,
    days: int | None,
) -> tuple[date | None, date | None]:
    """Resolve flexible range params: explicit from/to wins, then a rolling
    window of `days` ending today (SGT), else (None, None) = all-time."""
    if from_date is not None and to_date is not None:
        return from_date, to_date
    if days is not None:
        today = datetime.now(SGT).date()
        return today - timedelta(days=days - 1), today
    return None, None


def previous_period(from_date: date, to_date: date) -> tuple[date, date]:
    """Comparison window: the previous calendar month when the range is exactly
    a full month, otherwise the same-length window immediately before."""
    first = from_date.replace(day=1)
    last = from_date.replace(day=monthrange(from_date.year, from_date.month)[1])
    if from_date == first and to_date == last:
        prev_last = first - timedelta(days=1)
        return prev_last.replace(day=1), prev_last
    span = (to_date - from_date).days + 1
    prev_last = from_date - timedelta(days=1)
    return prev_last - timedelta(days=span - 1), prev_last


def _delta(current: Decimal | int | float, previous: Decimal | int | float) -> float | None:
    if not previous:
        return None
    return float((Decimal(str(current)) - Decimal(str(previous))) / Decimal(str(previous)) * 100)


def _to_sgt(created_at: datetime) -> datetime:
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return created_at.astimezone(SGT)


# ---------------------------------------------------------------------------
# Pure aggregation over order rows
# ---------------------------------------------------------------------------


def payment_display_split(order) -> dict[str, Decimal]:
    """Attribute an order's total across display buckets (sums to order.total).

    Split orders carry per-leg amounts; any unattributed residual lands in
    'Other' so the mix still balances to the order total.
    """
    buckets = {name: Decimal("0") for name in PAYMENT_BUCKETS}
    total = Decimal(str(order.total or 0))
    method = (order.payment_method or "").lower()

    if method == "split":
        cash = Decimal(str(order.cash_amount or 0))
        card = Decimal(str(order.card_amount or 0))
        voucher = Decimal(str(order.voucher_amount or 0)) + Decimal(str(order.cdc_amount or 0))
        buckets["Cash"] += cash
        buckets["Card"] += card
        buckets["Voucher"] += voucher
        residual = total - (cash + card + voucher)
        if residual != 0:
            buckets["Other"] += residual
    elif method == "cash":
        buckets["Cash"] += total
    elif method == "card":
        buckets["Card"] += total
    elif method == "paynow":
        buckets["PayNow"] += total
    elif method == "voucher":
        buckets["Voucher"] += total
    else:
        buckets["Other"] += total
    return buckets


class OrderAggregates:
    """Totals and SGT-calendar buckets accumulated from paid orders."""

    def __init__(self) -> None:
        self.gross = Decimal("0")
        self.net = Decimal("0")
        self.transactions = 0
        self.payments = {name: Decimal("0") for name in PAYMENT_BUCKETS}
        self.by_date: dict[date, list[Decimal | int]] = defaultdict(lambda: [Decimal("0"), 0])
        self.by_outlet: dict[UUID, list[Decimal | int]] = defaultdict(lambda: [Decimal("0"), 0])
        self.by_hour: dict[int, list[Decimal | int]] = defaultdict(lambda: [Decimal("0"), 0])


def aggregate_orders(orders) -> OrderAggregates:
    agg = OrderAggregates()
    for order in orders:
        total = Decimal(str(order.total or 0))
        local = _to_sgt(order.created_at)

        agg.gross += Decimal(str(order.subtotal or 0))
        agg.net += total
        agg.transactions += 1
        for name, amount in payment_display_split(order).items():
            agg.payments[name] += amount

        for bucket in (agg.by_date[local.date()], agg.by_outlet[order.outlet_id], agg.by_hour[local.hour]):
            bucket[0] += total
            bucket[1] += 1
    return agg


def day_of_week_averages(by_date: dict[date, list]) -> list[DayOfWeekPoint]:
    """Average daily net sales and transactions per weekday, over days with sales."""
    per_dow: dict[int, list[tuple[Decimal, int]]] = defaultdict(list)
    for day, (net, txns) in by_date.items():
        per_dow[day.weekday()].append((net, txns))

    points = []
    for dow in range(7):
        samples = per_dow.get(dow, [])
        n = len(samples)
        avg_sales = float(sum(s[0] for s in samples) / n) if n else 0.0
        avg_txns = (sum(s[1] for s in samples) / n) if n else 0.0
        points.append(DayOfWeekPoint(day=_DAY_NAMES[dow], avg_sales=round(avg_sales, 2), avg_transactions=round(avg_txns, 2)))
    return points


def concentration_from_quantities(quantities: list[int]) -> ConcentrationData:
    """Share of units sold captured by the top 3 / top 5 products."""
    ordered = sorted(quantities, reverse=True)
    total = sum(ordered)
    def share(n: int) -> float:
        return round(sum(ordered[:n]) / total * 100, 1) if total else 0.0
    return ConcentrationData(top3_pct=share(3), top5_pct=share(5), total_products=len(ordered))


# ---------------------------------------------------------------------------
# Dashboard assembly
# ---------------------------------------------------------------------------


def _paid_orders_stmt(from_date: date | None, to_date: date | None, outlet_id: UUID | None):
    stmt = select(Order).where(Order.status == OrderStatus.paid)
    if from_date is not None:
        stmt = stmt.where(Order.created_at >= sgt_day_bounds_utc(from_date)[0])
    if to_date is not None:
        stmt = stmt.where(Order.created_at < sgt_day_bounds_utc(to_date)[1])
    if outlet_id is not None:
        stmt = stmt.where(Order.outlet_id == outlet_id)
    return stmt


async def _product_rollup(
    db: AsyncSession,
    from_date: date | None,
    to_date: date | None,
    outlet_id: UUID | None,
) -> list[tuple[UUID, str, int, Decimal]]:
    """(product_id, name, quantity, revenue) per product for paid orders in range."""
    paid_ids = _paid_orders_stmt(from_date, to_date, outlet_id).with_only_columns(Order.id)
    stmt = (
        select(
            OrderItem.product_id,
            func.max(OrderItem.product_name).label("name"),
            func.coalesce(func.sum(OrderItem.quantity), 0).label("quantity"),
            func.coalesce(func.sum(OrderItem.quantity * OrderItem.unit_price), 0).label("revenue"),
        )
        .where(OrderItem.order_id.in_(paid_ids))
        .group_by(OrderItem.product_id)
    )
    rows = (await db.execute(stmt)).all()
    return [(r.product_id, r.name or "", int(r.quantity), Decimal(str(r.revenue))) for r in rows]


async def get_analytics_dashboard(
    db: AsyncSession,
    *,
    outlet_id: UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> AnalyticsDashboardResponse:
    orders = (await db.execute(_paid_orders_stmt(from_date, to_date, outlet_id))).scalars().all()
    agg = aggregate_orders(orders)
    products = await _product_rollup(db, from_date, to_date, outlet_id)

    items_sold = sum(p[2] for p in products)
    avg_ticket = (agg.net / agg.transactions) if agg.transactions else Decimal("0")

    # Previous-period comparison (only when the range is explicit).
    deltas: dict[str, float | None] = dict.fromkeys(
        ("gross_sales_delta", "net_sales_delta", "transactions_delta", "items_sold_delta", "avg_ticket_delta")
    )
    if from_date is not None and to_date is not None:
        prev_from, prev_to = previous_period(from_date, to_date)
        prev_orders = (await db.execute(_paid_orders_stmt(prev_from, prev_to, outlet_id))).scalars().all()
        prev = aggregate_orders(prev_orders)
        prev_products = await _product_rollup(db, prev_from, prev_to, outlet_id)
        prev_items = sum(p[2] for p in prev_products)
        prev_avg = (prev.net / prev.transactions) if prev.transactions else Decimal("0")
        deltas = {
            "gross_sales_delta": _delta(agg.gross, prev.gross),
            "net_sales_delta": _delta(agg.net, prev.net),
            "transactions_delta": _delta(agg.transactions, prev.transactions),
            "items_sold_delta": _delta(items_sold, prev_items),
            "avg_ticket_delta": _delta(avg_ticket, prev_avg),
        }

    # Per-outlet breakdown with names, best first.
    outlet_rows = (await db.execute(select(Outlet.id, Outlet.name))).all()
    outlet_names = {r.id: r.name for r in outlet_rows}
    sales_by_outlet = [
        OutletSalesItem(
            outlet_id=str(oid),
            outlet_name=outlet_names.get(oid, "Unknown"),
            net_sales=float(net),
            transactions=txns,
        )
        for oid, (net, txns) in sorted(agg.by_outlet.items(), key=lambda kv: kv[1][0], reverse=True)
    ]

    # Daily trend; zero-fill closed days when the range is explicit and sane.
    trend_dates = sorted(agg.by_date)
    if from_date is not None and to_date is not None and 0 <= (to_date - from_date).days <= 400:
        trend_dates = [from_date + timedelta(days=i) for i in range((to_date - from_date).days + 1)]
    trend = [
        TrendPoint(
            date=d.isoformat(),
            net_sales=float(agg.by_date[d][0]) if d in agg.by_date else 0.0,
            transactions=int(agg.by_date[d][1]) if d in agg.by_date else 0,
        )
        for d in trend_dates
    ]

    # Displayed date bounds: the requested range, else the observed one.
    today_iso = datetime.now(SGT).date().isoformat()
    date_from = (from_date.isoformat() if from_date else (trend_dates[0].isoformat() if trend_dates else today_iso))
    date_to = (to_date.isoformat() if to_date else (trend_dates[-1].isoformat() if trend_dates else today_iso))

    top_by_revenue = [
        TopProductItem(product_id=str(pid), name=name, quantity=qty, revenue=float(rev))
        for pid, name, qty, rev in sorted(products, key=lambda p: p[3], reverse=True)[:10]
    ]
    top_by_quantity = [
        TopProductItem(product_id=str(pid), name=name, quantity=qty, revenue=float(rev))
        for pid, name, qty, rev in sorted(products, key=lambda p: p[2], reverse=True)[:10]
    ]

    active_days = len(agg.by_date) or 1
    hourly = [
        HourlyPoint(
            hour=h,
            revenue=float(agg.by_hour[h][0]) if h in agg.by_hour else 0.0,
            transactions=int(agg.by_hour[h][1]) if h in agg.by_hour else 0,
            avg_sales=round(float(agg.by_hour[h][0]) / active_days, 2) if h in agg.by_hour else 0.0,
        )
        for h in range(24)
    ]

    return AnalyticsDashboardResponse(
        date_from=date_from,
        date_to=date_to,
        kpis=AnalyticsKpis(
            gross_sales=float(agg.gross),
            net_sales=float(agg.net),
            transactions=agg.transactions,
            items_sold=items_sold,
            avg_ticket=round(float(avg_ticket), 2),
            **deltas,
        ),
        payments=[
            PaymentBreakdownItem(method=name, amount=float(agg.payments[name]))
            for name in PAYMENT_BUCKETS
        ],
        sales_by_outlet=sales_by_outlet,
        trend=trend,
        top_by_revenue=top_by_revenue,
        top_by_quantity=top_by_quantity,
        day_of_week=day_of_week_averages(agg.by_date),
        hourly=hourly,
        concentration=concentration_from_quantities([p[2] for p in products]),
    )
