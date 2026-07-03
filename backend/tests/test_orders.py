"""Tests for order management API endpoints."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient

from sqlalchemy import select

from app.models.order import Order, OrderStatus
from app.schemas.order import OrderItemCreate, SelectedModifier


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, cashier_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {cashier_token}"


async def _create_order_payload(outlet_id: UUID, staff_id: UUID, product_id: UUID) -> dict:
    """Build a minimal order creation payload."""
    return {
        "outlet_id": str(outlet_id),
        "staff_id": str(staff_id),
        "items": [
            {
                "product_id": str(product_id),
                "quantity": 2,
                "modifiers": [],
                "notes": None,
            }
        ],
    }


class TestCreateOrder:
    """POST /api/orders"""

    async def test_create_order_requires_auth(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        client.headers.pop("Authorization", None)
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)

        resp = await client.post("/api/orders", json=payload)

        assert resp.status_code == 401

    async def test_create_with_multiple_items_and_modifiers(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = {
            "outlet_id": str(outlet.id),
            "staff_id": str(cashier_staff.id),
            "items": [
                {
                    "product_id": str(product.id),
                    "quantity": 2,
                    "modifiers": [
                        {"modifier_name": "Large", "price_adjustment": "1.50"}
                    ],
                    "notes": "No ice",
                },
                {
                    "product_id": str(product.id),
                    "quantity": 1,
                    "modifiers": [],
                    "notes": None,
                },
            ],
        }
        resp = await client.post("/api/orders", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["order_number"] == "0001"
        assert data["status"] == "pending"
        assert len(data["items"]) == 2

        # item 1: 2 x (9.99 + 1.50) = 22.98
        # item 2: 1 x 9.99 = 9.99
        # subtotal = 32.97
        assert str(data["subtotal"]) == "32.97"
        assert str(data["total"]) == "32.97"

    async def test_create_invalid_product_returns_404(
        self, client: AsyncClient, outlet, cashier_staff
    ) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        payload = {
            "outlet_id": str(outlet.id),
            "staff_id": str(cashier_staff.id),
            "items": [{"product_id": bogus, "quantity": 1}],
        }
        resp = await client.post("/api/orders", json=payload)
        assert resp.status_code == 404

    async def test_create_nonexistent_outlet_returns_404(
        self, client: AsyncClient, cashier_staff, product
    ) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        payload = {
            "outlet_id": bogus,
            "staff_id": str(cashier_staff.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        }
        resp = await client.post("/api/orders", json=payload)
        assert resp.status_code == 404

    async def test_create_with_customer_id_records_plotholders_purchase(
        self, client: AsyncClient, outlet, cashier_staff, product, monkeypatch
    ) -> None:
        recorded: dict[str, object] = {}

        class FakePlotholdersClient:
            async def record_purchase(self, **payload) -> dict[str, object]:
                recorded.update(payload)
                return {"id": "moment_1"}

        monkeypatch.setattr("app.services.orders.PlotholdersClient", FakePlotholdersClient)

        resp = await client.post(
            "/api/orders",
            json={
                "outlet_id": str(outlet.id),
                "staff_id": str(cashier_staff.id),
                "customer_id": "cus_1",
                "items": [{"product_id": str(product.id), "quantity": 1}],
            },
        )

        assert resp.status_code == 201
        data = resp.json()
        assert recorded["customer_id"] == "cus_1"
        assert recorded["order_id"] == UUID(data["id"])
        assert str(recorded["amount"]) == "9.99"
        assert recorded["outlet"] == outlet.name


class TestListOrders:
    """GET /api/orders"""

    async def test_empty(self, client: AsyncClient) -> None:
        resp = await client.get("/api/orders")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_with_orders(self, client: AsyncClient, outlet, cashier_staff, product) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        await client.post("/api/orders", json=payload)

        resp = await client.get("/api/orders")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["order_number"] == "0001"

    async def test_filter_by_outlet(self, client: AsyncClient, outlet, cashier_staff, product) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        await client.post("/api/orders", json=payload)

        resp = await client.get(f"/api/orders?outlet_id={outlet.id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/api/orders?outlet_id={bogus}")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_filter_by_status(self, client: AsyncClient, outlet, cashier_staff, product) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        await client.post("/api/orders", json=payload)

        resp = await client.get("/api/orders?status=pending")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/orders?status=paid")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_filter_by_date_range(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        await client.post("/api/orders", json=payload)

        yesterday = (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%d")
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        tomorrow = (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%d")

        # Filter by yesterday — should be empty
        resp = await client.get(f"/api/orders?date_from={yesterday}&date_to={yesterday}")
        assert resp.status_code == 200
        assert resp.json() == []

        # Filter by today — should find the order
        resp = await client.get(f"/api/orders?date_from={today}&date_to={tomorrow}")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_limit_offset(self, client: AsyncClient, outlet, cashier_staff, product) -> None:
        payload_base = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        for _ in range(3):
            await client.post("/api/orders", json=payload_base)

        resp = await client.get("/api/orders?limit=2")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

        resp = await client.get("/api/orders?limit=2&offset=2")
        assert resp.status_code == 200
        assert len(resp.json()) == 1


class TestGetOrder:
    """GET /api/orders/{id}"""

    async def test_get_single_order_with_items(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = {
            "outlet_id": str(outlet.id),
            "staff_id": str(cashier_staff.id),
            "items": [
                {
                    "product_id": str(product.id),
                    "quantity": 1,
                    "modifiers": [
                        {"modifier_name": "Large", "price_adjustment": "1.50"}
                    ],
                    "notes": "Extra hot",
                },
            ],
        }
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        resp = await client.get(f"/api/orders/{order_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["order_number"] == "0001"
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["quantity"] == 1
        assert str(item["unit_price"]) == "11.49"
        assert item["notes"] == "Extra hot"
        assert len(item["modifiers"]) == 1
        assert item["modifiers"][0]["modifier_name"] == "Large"

    async def test_not_found(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/api/orders/{bogus}")
        assert resp.status_code == 404


class TestTodayOrders:
    """GET /api/orders/today"""

    async def test_today_orders(self, client: AsyncClient, outlet, cashier_staff, product) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        await client.post("/api/orders", json=payload)

        resp = await client.get("/api/orders/today")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["order_number"] == "0001"

    async def test_today_orders_empty(self, client: AsyncClient) -> None:
        resp = await client.get("/api/orders/today")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_today_filter_by_outlet(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        await client.post("/api/orders", json=payload)

        resp = await client.get(f"/api/orders/today?outlet_id={outlet.id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 1


class TestUpdateOrderStatus:
    """PUT /api/orders/{id}/status"""

    async def test_pending_to_paid(self, client: AsyncClient, outlet, cashier_staff, product) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid", "payment_method": "cash", "payment_reference": "TXN001"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "paid"
        assert data["payment_method"] == "cash"
        assert data["payment_reference"] == "TXN001"

    async def test_pending_to_paid_manual_paynow_timestamp(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]
        confirmed_at = "2026-06-23T06:30:00+00:00"

        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={
                "status": "paid",
                "payment_method": "paynow",
                "payment_reference": "MANUAL",
                "paynow_confirmed_at": confirmed_at,
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "paid"
        assert data["payment_method"] == "paynow"
        assert data["payment_reference"] == "MANUAL"
        assert data["paynow_confirmed_at"].startswith("2026-06-23T06:30:00")

    async def test_pending_to_paid_with_split_amounts(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={
                "status": "paid",
                "payment_method": "split",
                "payment_reference": "TXN-SPLIT",
                "cash_tendered": "10.00",
                "cash_amount": "10.00",
                "card_amount": "9.98",
                "voucher_amount": "0.00",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "paid"
        assert data["payment_method"] == "split"
        assert str(data["cash_amount"]) == "10.00"
        assert str(data["card_amount"]) == "9.98"
        assert str(data["voucher_amount"]) == "0.00"
        assert str(data["cash_change"]) == "0.00"

    async def test_split_with_cdc_voucher_tender(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        # Total is 19.98: cash 5.00 + CDC 4.98 + card 10.00 must cover it.
        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={
                "status": "paid",
                "payment_method": "split",
                "payment_reference": "TXN-CDC",
                "cash_tendered": "5.00",
                "cash_amount": "5.00",
                "card_amount": "10.00",
                "cdc_amount": "4.98",
                "voucher_amount": "0.00",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "paid"
        assert str(data["cash_amount"]) == "5.00"
        assert str(data["card_amount"]) == "10.00"
        assert str(data["cdc_amount"]) == "4.98"

    async def test_split_cdc_can_cover_full_total(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        # CDC voucher covers the entire 19.98 total; no cash/card.
        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={
                "status": "paid",
                "payment_method": "split",
                "payment_reference": "TXN-CDC-FULL",
                "cash_amount": "0.00",
                "card_amount": "0.00",
                "cdc_amount": "19.98",
                "voucher_amount": "0.00",
            },
        )

        assert resp.status_code == 200
        assert str(resp.json()["cdc_amount"]) == "19.98"

    async def test_split_amounts_must_cover_payable_total(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={
                "status": "paid",
                "payment_method": "split",
                "cash_amount": "10.00",
                "card_amount": "1.00",
                "voucher_amount": "0.00",
            },
        )

        assert resp.status_code == 400
        assert "must equal the payable total" in resp.json()["detail"]

    async def test_pending_to_cancelled(
        self, client: AsyncClient, outlet, cashier_staff, product, manager_token
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "cancelled"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

    async def test_paid_to_refunded(
        self, client: AsyncClient, outlet, cashier_staff, product, manager_token
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        # First pay
        await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid", "payment_method": "card"},
        )

        # Then cancel
        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "cancelled"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

    async def test_invalid_transition_pending_to_refunded_returns_400(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "refunded"},
        )
        assert resp.status_code == 400
        assert "Cannot transition" in resp.json()["detail"]

    async def test_already_refunded_cannot_transition(
        self, client: AsyncClient, outlet, cashier_staff, product, manager_token
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        # Pay
        await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid"},
        )

        # Refund via the refund endpoint
        await client.post(
            f"/api/orders/{order_id}/refund",
            json={},
            headers={"Authorization": f"Bearer {manager_token}"},
        )

        # Try to change status again
        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "cancelled"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 400
        assert "Cannot transition" in resp.json()["detail"]


class TestRefundOrder:
    """POST /api/orders/{id}/refund"""

    async def test_refund_paid_order(
        self, client: AsyncClient, outlet, cashier_staff, product, manager_token
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        # Pay first
        await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid"},
        )

        # Refund
        resp = await client.post(
            f"/api/orders/{order_id}/refund",
            json={"reason": "Customer changed mind"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "refunded"

    async def test_refund_requires_manager(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid"},
        )

        resp = await client.post(f"/api/orders/{order_id}/refund", json={})

        assert resp.status_code == 403

    async def test_refund_non_paid_order_returns_400(
        self, client: AsyncClient, outlet, cashier_staff, product, manager_token
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/orders/{order_id}/refund",
            json={},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 400
        assert "not paid" in resp.json()["detail"].lower()


class TestAddItem:
    """POST /api/orders/{id}/items"""

    async def test_add_item_to_pending_order(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]
        assert len(create_resp.json()["items"]) == 1

        # Add another item
        resp = await client.post(
            f"/api/orders/{order_id}/items",
            json={"product_id": str(product.id), "quantity": 3},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert len(data["items"]) == 2
        # subtotal: 2 * 9.99 + 3 * 9.99 = 49.95
        assert str(data["subtotal"]) == "49.95"

    async def test_cannot_add_item_to_paid_order(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        # Pay
        await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid"},
        )

        # Try to add item
        resp = await client.post(
            f"/api/orders/{order_id}/items",
            json={"product_id": str(product.id), "quantity": 1},
        )
        assert resp.status_code == 400
        assert "Cannot modify" in resp.json()["detail"]


class TestRemoveItem:
    """DELETE /api/orders/{id}/items/{item_id}"""

    async def test_remove_item_from_pending_order(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]
        item_id = create_resp.json()["items"][0]["id"]

        resp = await client.delete(f"/api/orders/{order_id}/items/{item_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 0
        assert str(data["subtotal"]) == "0.00"
        assert str(data["total"]) == "0.00"

    async def test_cannot_remove_item_from_paid_order(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]
        item_id = create_resp.json()["items"][0]["id"]

        # Pay
        await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid"},
        )

        resp = await client.delete(f"/api/orders/{order_id}/items/{item_id}")
        assert resp.status_code == 400
        assert "Cannot modify" in resp.json()["detail"]

    async def test_remove_nonexistent_item_returns_404(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.delete(f"/api/orders/{order_id}/items/{bogus}")
        assert resp.status_code == 404


class TestOrderNumberAutoIncrement:
    """Order number logic"""

    async def test_auto_increment_per_outlet(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)

        order1 = await client.post("/api/orders", json=payload)
        assert order1.json()["order_number"] == "0001"

        order2 = await client.post("/api/orders", json=payload)
        assert order2.json()["order_number"] == "0002"

        order3 = await client.post("/api/orders", json=payload)
        assert order3.json()["order_number"] == "0003"

    async def test_separate_outlets_have_separate_counters(
        self, client: AsyncClient, db_session, outlet, cashier_staff, product, category, another_outlet
    ) -> None:
        from app.models.staff import Staff, StaffRole
        from app.models.product import Product
        from app.models.category import Category
        from app.utils.hashing import hash_pin

        # Create a staff member for the second outlet
        staff_b = Staff(
            name="Cashier B",
            role=StaffRole.cashier,
            outlet_id=another_outlet.id,
            pin_hash=hash_pin("1234"),
            is_active=True,
        )
        db_session.add(staff_b)

        # Create a category and product for the second outlet
        cat_b = Category(name="Cat B", sort_order=0, outlet_id=another_outlet.id)
        db_session.add(cat_b)
        await db_session.commit()
        await db_session.refresh(staff_b)
        await db_session.refresh(cat_b)

        product_b = Product(name="Product B", price=5.00, category_id=cat_b.id, is_available=True)
        db_session.add(product_b)
        await db_session.commit()
        await db_session.refresh(product_b)

        payload_a = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        payload_b = await _create_order_payload(another_outlet.id, staff_b.id, product_b.id)

        order_a1 = await client.post("/api/orders", json=payload_a)
        assert order_a1.status_code == 201
        assert order_a1.json()["order_number"] == "0001"

        order_b1 = await client.post("/api/orders", json=payload_b)
        assert order_b1.status_code == 201
        assert order_b1.json()["order_number"] == "0001"

        order_a2 = await client.post("/api/orders", json=payload_a)
        assert order_a2.status_code == 201
        assert order_a2.json()["order_number"] == "0002"

        order_b2 = await client.post("/api/orders", json=payload_b)
        assert order_b2.status_code == 201
        assert order_b2.json()["order_number"] == "0002"

    async def test_order_number_resets_daily(
        self, client: AsyncClient, db_session, outlet, cashier_staff, product
    ) -> None:
        """Verifies that order_number returns to 0001 when the day changes.
        We simulate this by manually adjusting the created_at timestamps.
        """
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)

        # Create first order today
        order1_resp = await client.post("/api/orders", json=payload)
        assert order1_resp.json()["order_number"] == "0001"

        # Move that order to yesterday by loading and updating the ORM object
        yesterday = datetime.now(UTC) - timedelta(days=1)
        result = await db_session.execute(
            select(Order).where(Order.id == UUID(order1_resp.json()["id"]))
        )
        order_obj = result.scalar_one()
        order_obj.created_at = yesterday
        await db_session.commit()

        # Create another order — should get 0001 again since yesterday's is ignored
        order2_resp = await client.post("/api/orders", json=payload)
        assert order2_resp.status_code == 201
        assert order2_resp.json()["order_number"] == "0001"
