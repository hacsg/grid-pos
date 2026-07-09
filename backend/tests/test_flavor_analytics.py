"""Tests for flavour analytics (name parsing, classification, endpoints)."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from zoneinfo import ZoneInfo

from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.services.flavor_analytics import build_rankings, parse_modifier_name

SGT = ZoneInfo("Asia/Singapore")


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_parse_modifier_name_flavor_prefix():
    assert parse_modifier_name("Gelato Flavors: Rocher") == ("Rocher", True)
    assert parse_modifier_name("Gelato Flavours: Yuzu") == ("Yuzu", True)


def test_parse_modifier_name_merges_dot_variants():
    # Prod has a duplicate "Gelato Flavors." group with dot-suffixed options.
    assert parse_modifier_name("Gelato Flavors.: Rocher.") == ("Rocher", True)
    assert parse_modifier_name("Gelato Flavors: Hojicha  Mochi.") == ("Hojicha Mochi", True)


def test_parse_modifier_name_addons():
    assert parse_modifier_name("Cone: Rosemary Cone") == ("Rosemary Cone", False)
    assert parse_modifier_name("Drinks Modifier: Extra Condensed Milk") == (
        "Extra Condensed Milk",
        False,
    )
    # Unprefixed names are add-ons.
    assert parse_modifier_name("Extra Napkins") == ("Extra Napkins", False)


def test_build_rankings_classification():
    months = ["2026-05", "2026-06", "2026-07"]
    data = {
        "Rocher": {"2026-05": 50, "2026-06": 60, "2026-07": 70},  # always #1
        "Yuzu": {"2026-05": 5, "2026-06": 20, "2026-07": 40},  # climbs
        "Matcha": {"2026-05": 30, "2026-06": 15, "2026-07": 8},  # falls
        "Ube": {"2026-05": 10, "2026-06": 10, "2026-07": 10},
        "Black Sesame": {"2026-05": 2, "2026-06": 1, "2026-07": 2},  # always last
    }
    items = {i.name: i for i in build_rankings(months, data)}

    assert items["Rocher"].classification == "consistent_top"
    assert items["Rocher"].monthly_rank == [1, 1, 1]
    assert items["Black Sesame"].classification == "consistent_bottom"
    assert items["Yuzu"].rank_change == 2  # rank 4 → 2
    assert items["Matcha"].rank_change == -2  # rank 2 → 4
    # Sorted by average rank: Rocher first.
    assert build_rankings(months, data)[0].name == "Rocher"


def test_build_rankings_no_sales_month_is_null_rank():
    months = ["2026-06", "2026-07"]
    data = {"Rocher": {"2026-07": 10}, "Yuzu": {"2026-06": 5, "2026-07": 5}}
    items = {i.name: i for i in build_rankings(months, data)}
    assert items["Rocher"].monthly_rank[0] is None
    assert items["Rocher"].monthly_rank[1] == 1


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, cashier_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {cashier_token}"


async def _seed_order_with_flavors(
    db_session,
    outlet_id: UUID,
    staff_id: UUID,
    product_id: UUID,
    created_sgt: datetime,
    modifiers: list[dict],
    quantity: int = 1,
) -> Order:
    order = Order(
        order_number="0001",
        outlet_id=outlet_id,
        staff_id=staff_id,
        subtotal=Decimal("10.00"),
        total=Decimal("10.00"),
        status=OrderStatus.paid,
        payment_method="cash",
    )
    order.created_at = created_sgt.astimezone(UTC)
    db_session.add(order)
    await db_session.flush()
    db_session.add(
        OrderItem(
            order_id=order.id,
            product_id=product_id,
            product_name="Single Scoop",
            quantity=quantity,
            unit_price=Decimal("6.00"),
            modifiers=modifiers,
        )
    )
    await db_session.commit()
    return order


@pytest.mark.asyncio
async def test_flavor_analysis_endpoint(client, db_session, outlet, cashier_staff, product):
    # Rocher sold twice (once via the dot-variant group), Yuzu once, plus a cone add-on.
    await _seed_order_with_flavors(
        db_session, outlet.id, cashier_staff.id, product.id,
        datetime(2026, 7, 2, 13, 0, tzinfo=SGT),
        [{"modifier_name": "Gelato Flavors: Rocher", "price_adjustment": "1"}],
    )
    await _seed_order_with_flavors(
        db_session, outlet.id, cashier_staff.id, product.id,
        datetime(2026, 7, 3, 15, 0, tzinfo=SGT),
        [
            {"modifier_name": "Gelato Flavors.: Rocher.", "price_adjustment": "1"},
            {"modifier_name": "Cone: Rosemary Cone", "price_adjustment": "1.5"},
        ],
    )
    await _seed_order_with_flavors(
        db_session, outlet.id, cashier_staff.id, product.id,
        datetime(2026, 7, 3, 16, 0, tzinfo=SGT),
        [{"modifier_name": "Gelato Flavors: Yuzu", "price_adjustment": "0"}],
    )

    resp = await client.get(
        "/api/analytics/flavors",
        params={"from_date": "2026-07-01", "to_date": "2026-07-07"},
    )
    assert resp.status_code == 200
    data = resp.json()

    flavors = {f["name"]: f for f in data["flavors"]}
    assert flavors["Rocher"]["total_qty"] == 2  # dot variant merged
    assert flavors["Rocher"]["rank"] == 1
    assert flavors["Rocher"]["share_pct"] == pytest.approx(66.7)
    assert flavors["Yuzu"]["total_qty"] == 1
    assert flavors["Rocher"]["days_sold"] == 2
    assert data["active_days"] == 2

    addons = {a["name"]: a for a in data["addons"]}
    assert addons["Rosemary Cone"]["total_qty"] == 1

    # Pareto is cumulative and ends at 100%.
    assert data["pareto"][0]["name"] == "Rocher"
    assert data["pareto"][-1]["cumulative_pct"] == 100.0

    # Day-of-week heatmap (Mon..Sun): 2 Jul 2026 = Thursday, 3 Jul = Friday.
    dow = {r["name"]: r["quantities"] for r in data["day_of_week"]}
    assert dow["Rocher"][3] == 1
    assert dow["Rocher"][4] == 1
    assert dow["Yuzu"][4] == 1


@pytest.mark.asyncio
async def test_flavor_rankings_endpoint(client, db_session, outlet, cashier_staff, product):
    for month, qty in ((6, 3), (7, 1)):
        for _ in range(qty):
            await _seed_order_with_flavors(
                db_session, outlet.id, cashier_staff.id, product.id,
                datetime(2026, month, 5, 13, 0, tzinfo=SGT),
                [{"modifier_name": "Gelato Flavors: Matcha", "price_adjustment": "0"}],
            )
    await _seed_order_with_flavors(
        db_session, outlet.id, cashier_staff.id, product.id,
        datetime(2026, 7, 6, 13, 0, tzinfo=SGT),
        [{"modifier_name": "Gelato Flavors: Yuzu", "price_adjustment": "0"}],
        quantity=2,
    )

    resp = await client.get("/api/analytics/flavor-rankings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["months"] == ["2026-06", "2026-07"]
    flavors = {f["name"]: f for f in data["flavors"]}
    assert flavors["Matcha"].get("monthly_rank") == [1, 2]
    assert flavors["Yuzu"]["monthly_rank"] == [None, 1]


@pytest.mark.asyncio
async def test_dashboard_scoop_ratio(client, db_session, outlet, cashier_staff, product):
    # product fixture name is "Test Product"; add Single/Double Scoop sales.
    order = Order(
        order_number="0002", outlet_id=outlet.id, staff_id=cashier_staff.id,
        subtotal=Decimal("20.00"), total=Decimal("20.00"),
        status=OrderStatus.paid, payment_method="cash",
    )
    order.created_at = datetime(2026, 7, 2, 13, 0, tzinfo=SGT).astimezone(UTC)
    db_session.add(order)
    await db_session.flush()
    db_session.add_all([
        OrderItem(order_id=order.id, product_id=product.id, product_name="Single Scoop",
                  quantity=3, unit_price=Decimal("6.00"), modifiers=[]),
        OrderItem(order_id=order.id, product_id=product.id, product_name="Double Scoop",
                  quantity=1, unit_price=Decimal("10.00"), modifiers=[]),
    ])
    await db_session.commit()

    resp = await client.get(
        "/api/analytics/dashboard",
        params={"from_date": "2026-07-01", "to_date": "2026-07-07"},
    )
    assert resp.status_code == 200
    ratio = resp.json()["scoop_ratio"]
    assert ratio["single_qty"] == 3
    assert ratio["double_qty"] == 1
    assert ratio["single_pct"] == 75.0
    assert ratio["double_pct"] == 25.0
