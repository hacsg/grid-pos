"""Tests for the reporting API — daily, weekly, monthly, product, staff, outlet."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.models.outlet import Outlet
from app.schemas.report import (
    DailyReportResponse,
    MonthlyReportResponse,
    ProductReportResponse,
    StaffReportResponse,
    WeeklyReportResponse,
    OutletReportResponse,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ANY_UUID = "00000000-0000-0000-0000-000000000000"


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, cashier_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {cashier_token}"


async def _seed_order(
    db_session,
    outlet_id: UUID,
    staff_id: UUID,
    total: Decimal,
    created_at: datetime,
    status: OrderStatus = OrderStatus.paid,
    payment_method: str = "card",
    order_number: str = "0001",
) -> Order:
    """Insert a minimal order for test data."""
    order = Order(
        order_number=order_number,
        outlet_id=outlet_id,
        staff_id=staff_id,
        subtotal=total,
        total=total,
        status=status,
        payment_method=payment_method,
    )
    order.created_at = created_at
    db_session.add(order)
    await db_session.commit()
    await db_session.refresh(order)
    return order


async def _seed_order_item(
    db_session,
    order_id: UUID,
    product_id: UUID,
    quantity: int = 1,
    unit_price: Decimal = Decimal("10.00"),
) -> OrderItem:
    """Insert a minimal order item."""
    item = OrderItem(
        order_id=order_id,
        product_id=product_id,
        quantity=quantity,
        unit_price=unit_price,
        modifiers=[],
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return item


# ---------------------------------------------------------------------------
# Daily report
# ---------------------------------------------------------------------------


class TestDailyReport:
    """GET /api/reports/daily"""

    async def test_with_orders(self, client: AsyncClient, db_session, outlet, cashier_staff):
        """Verify totals match seeded orders."""
        now = datetime.now(UTC)
        today = now.date()
        hour = now.hour

        # Create 2 paid orders today
        o1 = await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("20.50"), created_at=now,
            payment_method="card",
        )
        o2 = await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("10.00"), created_at=now,
            payment_method="paynow",
        )

        resp = await client.get(f"/api/reports/daily?date={today.isoformat()}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["date"] == today.isoformat()
        assert data["total_transactions"] == 2
        assert float(data["total_revenue"]) == 30.50
        assert float(data["average_ticket"]) == 15.25
        assert float(data["payment_breakdown"]["card"]) == 20.50
        assert float(data["payment_breakdown"]["paynow"]) == 10.00

        # Hourly should contain at least this hour
        hours = {h["hour"]: h for h in data["hourly_sales"]}
        assert hour in hours
        assert hours[hour]["transactions"] == 2

    async def test_no_orders_returns_zeros(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """No orders on the report date should return zeros, not 404."""
        today = datetime.now(UTC).date()
        resp = await client.get(f"/api/reports/daily?date={today.isoformat()}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_transactions"] == 0
        assert float(data["total_revenue"]) == 0.0
        assert float(data["average_ticket"]) == 0.0
        assert data["payment_breakdown"] == {}
        assert data["hourly_sales"] == []

    async def test_payment_breakdown_accuracy(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Payment breakdown sums should match total revenue."""
        now = datetime.now(UTC)
        today = now.date()

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("100.00"), created_at=now,
            payment_method="card",
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("50.00"), created_at=now,
            payment_method="paynow",
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("25.00"), created_at=now,
            payment_method="cash",
        )

        resp = await client.get(f"/api/reports/daily?date={today.isoformat()}")
        data = resp.json()
        assert float(data["total_revenue"]) == 175.0
        assert float(data["payment_breakdown"]["card"]) == 100.0
        assert float(data["payment_breakdown"]["paynow"]) == 50.0
        assert float(data["payment_breakdown"]["cash"]) == 25.0

    async def test_hourly_sales_grouping(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Orders at different hours appear in separate hourly buckets."""
        now = datetime.now(UTC)
        today = now.date()
        morning = now.replace(hour=9, minute=0, second=0, microsecond=0)
        afternoon = now.replace(hour=14, minute=0, second=0, microsecond=0)

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("15.00"), created_at=morning,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("25.00"), created_at=afternoon,
        )

        resp = await client.get(f"/api/reports/daily?date={today.isoformat()}")
        data = resp.json()
        hours = {h["hour"]: h for h in data["hourly_sales"]}
        assert 9 in hours
        assert 14 in hours
        assert float(hours[9]["revenue"]) == 15.0
        assert float(hours[14]["revenue"]) == 25.0

    async def test_change_percent_calculation(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Change percent vs same day last week."""
        now = datetime.now(UTC)
        today = now.date()
        last_week = now - timedelta(days=7)

        # Today: 100
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("100.00"), created_at=now,
        )
        # Last week: 50
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("50.00"), created_at=last_week,
        )

        resp = await client.get(f"/api/reports/daily?date={today.isoformat()}")
        data = resp.json()
        # (100 - 50) / 50 * 100 = 100%
        assert data["change_percent"] == 100.0

    async def test_change_percent_no_previous_data(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Change percent = 0 when there's no previous data."""
        now = datetime.now(UTC)
        today = now.date()

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("100.00"), created_at=now,
        )

        resp = await client.get(f"/api/reports/daily?date={today.isoformat()}")
        data = resp.json()
        assert data["change_percent"] == 0.0

    async def test_filter_by_outlet_id(
        self, client: AsyncClient, db_session, outlet, another_outlet, cashier_staff, manager_staff
    ):
        """Filtering by outlet_id returns only that outlet's data."""
        now = datetime.now(UTC)
        today = now.date()

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("100.00"), created_at=now,
        )
        await _seed_order(
            db_session, another_outlet.id, manager_staff.id,
            total=Decimal("200.00"), created_at=now,
        )

        resp = await client.get(
            f"/api/reports/daily?date={today.isoformat()}&outlet_id={outlet.id}"
        )
        data = resp.json()
        assert float(data["total_revenue"]) == 100.0
        assert data["total_transactions"] == 1

    async def test_excludes_non_paid_orders(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Pending / refunded / cancelled orders should not be counted."""
        now = datetime.now(UTC)
        today = now.date()

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("50.00"), created_at=now, status=OrderStatus.paid,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("30.00"), created_at=now, status=OrderStatus.pending,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("20.00"), created_at=now, status=OrderStatus.refunded,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("10.00"), created_at=now, status=OrderStatus.cancelled,
        )

        resp = await client.get(f"/api/reports/daily?date={today.isoformat()}")
        data = resp.json()
        assert float(data["total_revenue"]) == 50.0
        assert data["total_transactions"] == 1


# ---------------------------------------------------------------------------
# Weekly report
# ---------------------------------------------------------------------------


class TestWeeklyReport:
    """GET /api/reports/weekly"""

    async def test_weekly_aggregation(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Orders in the same ISO week are aggregated."""
        # Use a known ISO week: 2026-W23 is June 1-7, 2026
        # Monday June 1, 2026
        monday = datetime(2026, 6, 1, 10, 0, 0, tzinfo=UTC)
        wednesday = datetime(2026, 6, 3, 14, 0, 0, tzinfo=UTC)

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("100.00"), created_at=monday,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("50.00"), created_at=wednesday,
        )

        resp = await client.get("/api/reports/weekly?week=2026-W23")
        assert resp.status_code == 200
        data = resp.json()
        assert float(data["total_revenue"]) == 150.0
        assert data["total_transactions"] == 2

    async def test_weekly_change_percent(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Change percent vs previous ISO week."""
        # 2026-W23 = June 1-7
        # 2026-W22 = May 25-31
        this_monday = datetime(2026, 6, 1, 10, 0, 0, tzinfo=UTC)
        prev_monday = datetime(2026, 5, 25, 10, 0, 0, tzinfo=UTC)

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("120.00"), created_at=this_monday,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("80.00"), created_at=prev_monday,
        )

        resp = await client.get("/api/reports/weekly?week=2026-W23")
        data = resp.json()
        # (120 - 80) / 80 * 100 = 50%
        assert data["change_percent"] == 50.0


# ---------------------------------------------------------------------------
# Monthly report
# ---------------------------------------------------------------------------


class TestMonthlyReport:
    """GET /api/reports/monthly"""

    async def test_monthly_aggregation(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Orders in the same month are aggregated."""
        june_1 = datetime(2026, 6, 1, 10, 0, 0, tzinfo=UTC)
        june_15 = datetime(2026, 6, 15, 14, 0, 0, tzinfo=UTC)

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("300.00"), created_at=june_1,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("200.00"), created_at=june_15,
        )

        resp = await client.get("/api/reports/monthly?month=2026-06")
        assert resp.status_code == 200
        data = resp.json()
        assert float(data["total_revenue"]) == 500.0
        assert data["total_transactions"] == 2

    async def test_monthly_change_percent(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Change percent vs previous month."""
        june_1 = datetime(2026, 6, 1, 10, 0, 0, tzinfo=UTC)
        may_15 = datetime(2026, 5, 15, 10, 0, 0, tzinfo=UTC)

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("500.00"), created_at=june_1,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("250.00"), created_at=may_15,
        )

        resp = await client.get("/api/reports/monthly?month=2026-06")
        data = resp.json()
        # (500 - 250) / 250 * 100 = 100%
        assert data["change_percent"] == 100.0


# ---------------------------------------------------------------------------
# Product report
# ---------------------------------------------------------------------------


class TestProductReport:
    """GET /api/reports/products"""

    async def test_product_performance_ranking(
        self, client: AsyncClient, db_session, outlet, cashier_staff, product, category
    ):
        """Products are ranked by revenue."""
        now = datetime.now(UTC)
        today = now.date()
        order = await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("39.96"), created_at=now,
        )
        await _seed_order_item(
            db_session, order.id, product.id,
            quantity=4, unit_price=Decimal("9.99"),
        )

        resp = await client.get(
            f"/api/reports/products?date_from={today.isoformat()}&date_to={today.isoformat()}"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["products"]) == 1
        assert data["products"][0]["name"] == "Test Product"
        assert data["products"][0]["units_sold"] == 4
        assert float(data["products"][0]["revenue"]) == 39.96

    async def test_category_breakdown(
        self, client: AsyncClient, db_session, outlet, cashier_staff, product, category
    ):
        """Category breakdown shows percentage of total revenue."""
        now = datetime.now(UTC)
        today = now.date()
        order = await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("19.98"), created_at=now,
        )
        await _seed_order_item(
            db_session, order.id, product.id,
            quantity=2, unit_price=Decimal("9.99"),
        )

        resp = await client.get(
            f"/api/reports/products?date_from={today.isoformat()}&date_to={today.isoformat()}"
        )
        data = resp.json()
        assert len(data["category_breakdown"]) == 1
        assert data["category_breakdown"][0]["category"] == "Test Category"
        assert float(data["category_breakdown"][0]["revenue"]) == 19.98
        assert data["category_breakdown"][0]["percentage"] == 100.0


# ---------------------------------------------------------------------------
# Staff report
# ---------------------------------------------------------------------------


class TestStaffReport:
    """GET /api/reports/staff"""

    async def test_staff_performance_ranking(
        self, client: AsyncClient, db_session, outlet, cashier_staff
    ):
        """Staff are ranked by revenue."""
        now = datetime.now(UTC)
        today = now.date()

        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("50.00"), created_at=now,
        )
        await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("30.00"), created_at=now,
        )

        resp = await client.get(
            f"/api/reports/staff?date_from={today.isoformat()}&date_to={today.isoformat()}"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["staff"]) == 1
        staff = data["staff"][0]
        assert staff["name"] == "Cashier User"
        assert staff["transactions"] == 2
        assert float(staff["revenue"]) == 80.0
        assert float(staff["average_ticket"]) == 40.0


# ---------------------------------------------------------------------------
# Outlet report
# ---------------------------------------------------------------------------


class TestOutletReport:
    """GET /api/reports/outlets"""

    async def test_outlet_comparison(
        self, client: AsyncClient, db_session, outlet, another_outlet, cashier_staff, manager_staff, product, category
    ):
        """Multiple outlets are compared."""
        now = datetime.now(UTC)
        today = now.date()

        order1 = await _seed_order(
            db_session, outlet.id, cashier_staff.id,
            total=Decimal("100.00"), created_at=now,
        )
        await _seed_order_item(
            db_session, order1.id, product.id,
            quantity=5, unit_price=Decimal("20.00"),
        )

        order2 = await _seed_order(
            db_session, another_outlet.id, manager_staff.id,
            total=Decimal("200.00"), created_at=now,
        )
        await _seed_order_item(
            db_session, order2.id, product.id,
            quantity=10, unit_price=Decimal("20.00"),
        )

        resp = await client.get(
            f"/api/reports/outlets?date_from={today.isoformat()}&date_to={today.isoformat()}"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["outlets"]) == 2

        # Sorted by revenue descending
        assert float(data["outlets"][0]["revenue"]) == 200.0
        assert data["outlets"][0]["name"] == "Another Outlet"
        assert float(data["outlets"][1]["revenue"]) == 100.0
        assert data["outlets"][1]["name"] == "Test Outlet"

        # top_product should be populated
        assert data["outlets"][0]["top_product"] == "Test Product"
        assert data["outlets"][1]["top_product"] == "Test Product"


# ---------------------------------------------------------------------------
# Response model validation
# ---------------------------------------------------------------------------


class TestResponseModels:
    """Verify that response models match expected shapes."""

    def test_daily_report_response_shape(self):
        r = DailyReportResponse(
            date="2026-06-07",
            total_revenue=Decimal("3245.50"),
            total_transactions=312,
            average_ticket=Decimal("10.40"),
            change_percent=12.5,
            payment_breakdown={"card": Decimal("2110.00")},
            hourly_sales=[],
        )
        assert r.date.isoformat() == "2026-06-07"

    def test_weekly_report_response_shape(self):
        r = WeeklyReportResponse(week="2026-W23")
        assert r.week == "2026-W23"

    def test_monthly_report_response_shape(self):
        r = MonthlyReportResponse(month="2026-06")
        assert r.month == "2026-06"

    def test_product_report_response_shape(self):
        r = ProductReportResponse()
        assert r.products == []
        assert r.category_breakdown == []

    def test_staff_report_response_shape(self):
        r = StaffReportResponse()
        assert r.staff == []

    def test_outlet_report_response_shape(self):
        r = OutletReportResponse()
        assert r.outlets == []
