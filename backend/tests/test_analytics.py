"""Tests for the sales analytics dashboard (service helpers + API endpoint)."""

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.services.analytics import (
    aggregate_orders,
    concentration_from_quantities,
    day_of_week_averages,
    payment_display_split,
    previous_period,
    resolve_date_range,
)

SGT = ZoneInfo("Asia/Singapore")


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _order(total, subtotal=None, method="cash", when=None, outlet_id=None, **kw):
    created = when or datetime(2026, 7, 1, 14, 0, tzinfo=SGT)
    return SimpleNamespace(
        total=Decimal(str(total)),
        subtotal=Decimal(str(subtotal if subtotal is not None else total)),
        payment_method=method,
        cash_amount=kw.get("cash_amount"),
        card_amount=kw.get("card_amount"),
        voucher_amount=kw.get("voucher_amount"),
        cdc_amount=kw.get("cdc_amount"),
        created_at=created.astimezone(UTC),
        outlet_id=outlet_id or UUID(int=1),
    )


def test_resolve_date_range_explicit_wins():
    assert resolve_date_range(date(2026, 7, 1), date(2026, 7, 5), days=30) == (
        date(2026, 7, 1),
        date(2026, 7, 5),
    )


def test_resolve_date_range_all_time():
    assert resolve_date_range(None, None, None) == (None, None)


def test_previous_period_full_month_compares_previous_month():
    assert previous_period(date(2026, 7, 1), date(2026, 7, 31)) == (
        date(2026, 6, 1),
        date(2026, 6, 30),
    )


def test_previous_period_partial_range_same_length():
    # 7-day window → the 7 days immediately before.
    assert previous_period(date(2026, 7, 4), date(2026, 7, 10)) == (
        date(2026, 6, 27),
        date(2026, 7, 3),
    )


def test_payment_split_single_methods():
    assert payment_display_split(_order("10.00", method="cash"))["Cash"] == Decimal("10.00")
    assert payment_display_split(_order("10.00", method="card"))["Card"] == Decimal("10.00")
    assert payment_display_split(_order("10.00", method="paynow"))["PayNow"] == Decimal("10.00")


def test_payment_split_split_order_balances_to_total():
    split = payment_display_split(
        _order("12.00", method="split", cash_amount="5.00", card_amount="4.00", cdc_amount="2.00")
    )
    assert split["Cash"] == Decimal("5.00")
    assert split["Card"] == Decimal("4.00")
    assert split["Voucher"] == Decimal("2.00")
    assert split["Other"] == Decimal("1.00")  # residual keeps the mix balanced
    assert sum(split.values()) == Decimal("12.00")


def test_aggregate_orders_buckets_by_sgt_day_and_hour():
    # 00:30 SGT on 2 July = 16:30 UTC on 1 July; must land on the SGT date/hour.
    orders = [_order("8.00", when=datetime(2026, 7, 2, 0, 30, tzinfo=SGT))]
    agg = aggregate_orders(orders)
    assert list(agg.by_date) == [date(2026, 7, 2)]
    assert list(agg.by_hour) == [0]
    assert agg.net == Decimal("8.00")


def test_day_of_week_averages_means_days_with_sales():
    by_date = {
        date(2026, 6, 29): [Decimal("100"), 10],  # Monday
        date(2026, 7, 6): [Decimal("300"), 20],  # Monday
        date(2026, 7, 7): [Decimal("50"), 5],  # Tuesday
    }
    points = {p.day: p for p in day_of_week_averages(by_date)}
    assert points["Monday"].avg_sales == 200.0
    assert points["Monday"].avg_transactions == 15.0
    assert points["Tuesday"].avg_sales == 50.0
    assert points["Sunday"].avg_sales == 0.0


def test_concentration_top3_top5():
    data = concentration_from_quantities([50, 30, 20, 10, 5, 5])
    assert data.top3_pct == pytest.approx(83.3)
    assert data.top5_pct == pytest.approx(95.8)
    assert data.total_products == 6


# ---------------------------------------------------------------------------
# API endpoint
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, cashier_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {cashier_token}"


async def _seed_order(
    db_session,
    outlet_id: UUID,
    staff_id: UUID,
    total: Decimal,
    created_sgt: datetime,
    payment_method: str = "cash",
    status: OrderStatus = OrderStatus.paid,
    subtotal: Decimal | None = None,
) -> Order:
    order = Order(
        order_number="0001",
        outlet_id=outlet_id,
        staff_id=staff_id,
        subtotal=subtotal if subtotal is not None else total,
        total=total,
        status=status,
        payment_method=payment_method,
    )
    order.created_at = created_sgt.astimezone(UTC)
    db_session.add(order)
    await db_session.commit()
    await db_session.refresh(order)
    return order


async def _seed_item(db_session, order_id: UUID, product_id: UUID, name: str, qty: int, price: str):
    item = OrderItem(
        order_id=order_id,
        product_id=product_id,
        product_name=name,
        quantity=qty,
        unit_price=Decimal(price),
        modifiers=[],
    )
    db_session.add(item)
    await db_session.commit()


@pytest.mark.asyncio
async def test_dashboard_endpoint(client, db_session, outlet, cashier_staff, product):
    # Current period: 1–7 July 2026. Two paid orders + one refunded (ignored).
    o1 = await _seed_order(
        db_session, outlet.id, cashier_staff.id, Decimal("20.00"),
        datetime(2026, 7, 2, 12, 30, tzinfo=SGT), payment_method="cash",
        subtotal=Decimal("25.00"),
    )
    o2 = await _seed_order(
        db_session, outlet.id, cashier_staff.id, Decimal("30.00"),
        datetime(2026, 7, 5, 18, 10, tzinfo=SGT), payment_method="paynow",
    )
    await _seed_order(
        db_session, outlet.id, cashier_staff.id, Decimal("99.00"),
        datetime(2026, 7, 3, 12, 0, tzinfo=SGT), status=OrderStatus.refunded,
    )
    await _seed_item(db_session, o1.id, product.id, "Test Product", 2, "10.00")
    other_product_id = uuid4()
    # Previous period order (24–30 June) for delta computation.
    prev = await _seed_order(
        db_session, outlet.id, cashier_staff.id, Decimal("25.00"),
        datetime(2026, 6, 27, 15, 0, tzinfo=SGT), payment_method="card",
    )

    resp = await client.get(
        "/api/analytics/dashboard",
        params={"from_date": "2026-07-01", "to_date": "2026-07-07"},
    )
    assert resp.status_code == 200
    data = resp.json()

    assert data["date_from"] == "2026-07-01"
    assert data["date_to"] == "2026-07-07"
    kpis = data["kpis"]
    assert kpis["gross_sales"] == 55.0  # 25 + 30
    assert kpis["net_sales"] == 50.0
    assert kpis["transactions"] == 2
    assert kpis["items_sold"] == 2
    assert kpis["avg_ticket"] == 25.0
    # 50 vs 25 in the previous 7 days → +100%.
    assert kpis["net_sales_delta"] == pytest.approx(100.0)

    payments = {p["method"]: p["amount"] for p in data["payments"]}
    assert payments["Cash"] == 20.0
    assert payments["PayNow"] == 30.0
    assert payments["Card"] == 0.0

    # Trend zero-fills the 7 requested days.
    assert len(data["trend"]) == 7
    by_day = {t["date"]: t["net_sales"] for t in data["trend"]}
    assert by_day["2026-07-02"] == 20.0
    assert by_day["2026-07-03"] == 0.0

    assert data["sales_by_outlet"][0]["outlet_name"] == "Test Outlet"
    assert data["sales_by_outlet"][0]["net_sales"] == 50.0

    assert data["top_by_revenue"][0]["name"] == "Test Product"
    assert data["top_by_revenue"][0]["revenue"] == 20.0
    assert data["concentration"]["total_products"] == 1

    hourly = {h["hour"]: h for h in data["hourly"]}
    assert hourly[12]["revenue"] == 20.0
    assert hourly[18]["revenue"] == 30.0


@pytest.mark.asyncio
async def test_dashboard_requires_auth(client):
    client.headers.pop("Authorization", None)
    resp = await client.get("/api/analytics/dashboard")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_dashboard_outlet_filter(client, db_session, outlet, cashier_staff):
    await _seed_order(
        db_session, outlet.id, cashier_staff.id, Decimal("10.00"),
        datetime(2026, 7, 2, 12, 0, tzinfo=SGT),
    )
    resp = await client.get(
        "/api/analytics/dashboard",
        params={"from_date": "2026-07-01", "to_date": "2026-07-07", "outlet_id": str(uuid4())},
    )
    assert resp.status_code == 200
    assert resp.json()["kpis"]["net_sales"] == 0.0
