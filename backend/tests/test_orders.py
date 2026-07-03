"""Tests for order management API endpoints."""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient

from sqlalchemy import select

from app.models.order import Order, OrderStatus
from app.models.refund import Refund
from app.models.voucher import OrderVoucher
from app.schemas.order import OrderCreate, OrderItemCreate, SelectedModifier
from app.services import orders as orders_service
from app.services.orders import create_order as create_order_service, next_order_number, quantize_money
from app.services.vouchers import apply_vouchers_to_order


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

    async def test_create_order_ignores_client_status(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        """Client-supplied status must be ignored; orders are always born pending (1.2a)."""
        payload = {
            "outlet_id": str(outlet.id),
            "staff_id": str(cashier_staff.id),
            "status": "paid",  # malicious client attempt
            "items": [{"product_id": str(product.id), "quantity": 1}],
        }
        resp = await client.post("/api/orders", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "pending"
        assert str(data["total"]) == "9.99"

    async def test_create_order_rejects_discount_exceeding_subtotal(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        """loyalty_discount > subtotal is rejected with 400 (1.2b)."""
        payload = {
            "outlet_id": str(outlet.id),
            "staff_id": str(cashier_staff.id),
            "loyalty_discount": "9999.00",
            "items": [{"product_id": str(product.id), "quantity": 1}],
        }
        resp = await client.post("/api/orders", json=payload)
        assert resp.status_code == 400
        assert "Discount cannot exceed subtotal" in resp.json().get("detail", "")


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

    @pytest.mark.skip(
        reason="SQLite test DB doesn't support SELECT ... FOR UPDATE — covered by Postgres integration tests"
    )
    async def test_concurrent_mark_paid_only_first_succeeds(
        self, client: AsyncClient, outlet, cashier_staff, product, monkeypatch
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        assert create_resp.status_code == 201
        order_id = create_resp.json()["id"]

        from app.routers import orders as orders_router

        real_update = orders_router.update_order_status_service
        started = 0
        both_started = asyncio.Event()
        serialize = asyncio.Lock()

        async def delayed_update(*args, **kwargs):
            nonlocal started
            started += 1
            if started == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), timeout=5)
            async with serialize:
                return await real_update(*args, **kwargs)

        monkeypatch.setattr(orders_router, "update_order_status_service", delayed_update)

        async def mark_paid() -> int:
            resp = await client.put(
                f"/api/orders/{order_id}/status",
                json={"status": "paid", "payment_method": "cash"},
            )
            return resp.status_code

        status_codes = await asyncio.gather(mark_paid(), mark_paid())

        assert status_codes.count(200) == 1
        assert any(code in {400, 409} for code in status_codes)

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
                "cash_amount": "15.00",
                "cdc_amount": "10.00",
                "card_amount": "0.00",
                "voucher_amount": "0.00",
            },
        )

        assert resp.status_code == 400
        assert "exceed the total" in resp.json()["detail"]

    async def test_split_order_no_false_400_on_rounding_boundary(
        self, client: AsyncClient, db_session, outlet, cashier_staff, category
    ) -> None:
        """Client float rounding must not 400 after terminal charge; server derives card leg."""
        from app.models.product import Product

        product = Product(name="Rounding Product", price=10.05, category_id=category.id, is_available=True)
        db_session.add(product)
        await db_session.commit()
        await db_session.refresh(product)

        payload = {
            "outlet_id": str(outlet.id),
            "staff_id": str(cashier_staff.id),
            "loyalty_discount": "3.32",
            "items": [{"product_id": str(product.id), "quantity": 1, "modifiers": []}],
        }
        create_resp = await client.post("/api/orders", json=payload)
        assert create_resp.status_code == 201
        order_id = create_resp.json()["id"]
        assert str(create_resp.json()["total"]) == "6.73"

        cash_amount = Decimal("2.00")
        cdc_amount = Decimal("1.50")
        expected_card = quantize_money(Decimal("6.73") - cash_amount - cdc_amount)
        assert expected_card == Decimal("3.23")

        resp = await client.put(
            f"/api/orders/{order_id}/status",
            json={
                "status": "paid",
                "payment_method": "split",
                "payment_reference": "TXN-ROUND",
                "cash_amount": "2.00",
                "cdc_amount": "1.50",
                "card_amount": "3.24",
                "voucher_amount": "0.00",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert str(data["card_amount"]) == "3.23"
        assert str(data["cash_amount"]) == "2.00"
        assert str(data["cdc_amount"]) == "1.50"

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

    async def test_update_status_paid_on_already_paid_is_idempotent(
        self, client: AsyncClient, outlet, cashier_staff, product
    ) -> None:
        """PUT /status to paid on already-paid order returns 200 (2.3 idempotency path)."""
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        # First mark paid (via normal path)
        resp1 = await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid", "payment_method": "cash"},
        )
        assert resp1.status_code == 200
        assert resp1.json()["status"] == "paid"

        # Re-call should be no-op success
        resp2 = await client.put(
            f"/api/orders/{order_id}/status",
            json={"status": "paid", "payment_method": "cash"},
        )
        assert resp2.status_code == 200
        assert resp2.json()["status"] == "paid"


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

    async def test_refund_creates_refund_record(
        self,
        client: AsyncClient,
        db_session,
        outlet,
        cashier_staff,
        product,
        manager_token,
        manager_staff,
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]
        order_total = Decimal(create_resp.json()["total"])

        await client.put(f"/api/orders/{order_id}/status", json={"status": "paid"})

        resp = await client.post(
            f"/api/orders/{order_id}/refund",
            json={"reason": "Customer changed mind"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 200

        result = await db_session.execute(
            select(Refund).where(Refund.order_id == UUID(order_id))
        )
        refund = result.scalar_one()
        assert refund.reason == "Customer changed mind"
        assert refund.amount == order_total
        assert refund.staff_id == manager_staff.id
        assert refund.kind == "full"

    async def test_partial_refund_keeps_order_paid(
        self,
        client: AsyncClient,
        db_session,
        outlet,
        cashier_staff,
        product,
        manager_token,
        manager_staff,
    ) -> None:
        product.price = Decimal("10.00")
        await db_session.commit()
        await db_session.refresh(product)

        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        payload["items"][0]["quantity"] = 1
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]
        assert create_resp.json()["total"] == "10.00"

        await client.put(f"/api/orders/{order_id}/status", json={"status": "paid"})

        resp = await client.post(
            f"/api/orders/{order_id}/refund",
            json={"amount": "5.00", "reason": "Partial refund"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "paid"

        result = await db_session.execute(
            select(Refund).where(Refund.order_id == UUID(order_id))
        )
        refund = result.scalar_one()
        assert refund.amount == Decimal("5.00")
        assert refund.kind == "partial"
        assert refund.staff_id == manager_staff.id

    async def test_list_order_refunds(
        self, client: AsyncClient, outlet, cashier_staff, product, manager_token
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]
        await client.put(f"/api/orders/{order_id}/status", json={"status": "paid"})
        await client.post(
            f"/api/orders/{order_id}/refund",
            json={"reason": "Test"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )

        resp = await client.get(f"/api/orders/{order_id}/refunds")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["reason"] == "Test"
        assert data[0]["kind"] == "full"


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

    async def test_next_order_number_uses_sgt_day_boundary(
        self, client: AsyncClient, db_session, outlet, cashier_staff, product
    ) -> None:
        """Order numbers share a Singapore business day across the 8am UTC-midnight seam."""
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        order1_resp = await client.post("/api/orders", json=payload)
        assert order1_resp.json()["order_number"] == "0001"

        # 7:59 AM SGT on Jan 15 = Jan 14 23:59 UTC
        sgt_morning = datetime(2026, 1, 14, 23, 59, tzinfo=UTC)
        result = await db_session.execute(
            select(Order).where(Order.id == UUID(order1_resp.json()["id"]))
        )
        order_obj = result.scalar_one()
        order_obj.created_at = sgt_morning
        await db_session.commit()

        # 8:01 AM SGT on Jan 15 = Jan 15 00:01 UTC — same SGT business day
        eight_am_sgt = datetime(2026, 1, 15, 0, 1, tzinfo=UTC)
        assert await next_order_number(db_session, outlet.id, now=eight_am_sgt) == "0002"

        # SGT midnight Jan 16 = Jan 15 16:00 UTC — new business day
        sgt_midnight = datetime(2026, 1, 15, 16, 0, tzinfo=UTC)
        assert await next_order_number(db_session, outlet.id, now=sgt_midnight) == "0001"


class TestSGTTodayOrders:
    """GET /api/orders/today uses Singapore business-day boundaries."""

    async def test_list_today_orders_uses_sgt(
        self, client: AsyncClient, db_session, outlet, cashier_staff, product, monkeypatch
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        create_resp = await client.post("/api/orders", json=payload)
        order_id = create_resp.json()["id"]

        # Backdate to 7:59 AM SGT (still the same SGT calendar day as 8:01 AM)
        sgt_morning = datetime(2026, 1, 14, 23, 59, tzinfo=UTC)
        result = await db_session.execute(select(Order).where(Order.id == UUID(order_id)))
        order_obj = result.scalar_one()
        order_obj.created_at = sgt_morning
        await db_session.commit()

        eight_am_sgt = datetime(2026, 1, 15, 0, 1, tzinfo=UTC)
        day_start, day_end = orders_service.business_day_bounds(eight_am_sgt)
        monkeypatch.setattr(
            "app.routers.orders.business_day_bounds",
            lambda now=None: (day_start, day_end),
        )

        resp = await client.get("/api/orders/today")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["id"] == order_id


class _MockPlotholdersClient:
    """Minimal Plotholders stub for voucher application tests."""

    def __init__(self, vouchers_by_code: dict[str, dict]) -> None:
        self.vouchers_by_code = vouchers_by_code
        self.redeem_calls: list[str] = []

    async def get_voucher(self, code: str) -> dict | None:
        return self.vouchers_by_code.get(code)

    async def redeem_voucher_by_code(self, code: str, staff_id: str, outlet: str) -> dict:
        self.redeem_calls.append(code)
        return {"status": "redeemed"}


class TestVoucherApplication:
    """Voucher apply atomicity and amount handling."""

    async def _create_pending_order(
        self, db_session, outlet, cashier_staff, product, *, price: Decimal | None = None
    ) -> Order:
        from app.models.product import Product

        if price is not None:
            product.price = price
            await db_session.commit()
            await db_session.refresh(product)

        payload = OrderCreate(
            outlet_id=outlet.id,
            staff_id=cashier_staff.id,
            items=[OrderItemCreate(product_id=product.id, quantity=1)],
        )
        return await create_order_service(db_session, payload)

    async def test_voucher_application_atomic_on_second_code_failure(
        self, db_session, outlet, cashier_staff, product
    ) -> None:
        order = await self._create_pending_order(db_session, outlet, cashier_staff, product)
        mock_client = _MockPlotholdersClient(
            {
                "GOOD-1": {"code": "GOOD-1", "amount": "5.00"},
                "BAD-2": {"code": "BAD-2", "amount": "5.00", "redeemed": True},
            }
        )

        with pytest.raises(Exception) as exc_info:
            await apply_vouchers_to_order(
                db_session,
                order_id=order.id,
                codes=["GOOD-1", "BAD-2"],
                staff=cashier_staff,
                plotholders=mock_client,
            )

        assert exc_info.value.status_code == 409
        assert mock_client.redeem_calls == []

        result = await db_session.execute(select(OrderVoucher).where(OrderVoucher.order_id == order.id))
        assert result.scalars().all() == []

    async def test_voucher_unparseable_amount_raises_422(
        self, db_session, outlet, cashier_staff, product
    ) -> None:
        order = await self._create_pending_order(db_session, outlet, cashier_staff, product)
        mock_client = _MockPlotholdersClient(
            {"BAD-AMT": {"code": "BAD-AMT", "amount": "not-a-number"}}
        )

        with pytest.raises(Exception) as exc_info:
            await apply_vouchers_to_order(
                db_session,
                order_id=order.id,
                codes=["BAD-AMT"],
                staff=cashier_staff,
                plotholders=mock_client,
            )

        assert exc_info.value.status_code == 422
        assert "Voucher amount could not be determined" in exc_info.value.detail
        assert mock_client.redeem_calls == []

    async def test_voucher_amount_capped_at_remaining_total(
        self, db_session, outlet, cashier_staff, product
    ) -> None:
        order = await self._create_pending_order(
            db_session, outlet, cashier_staff, product, price=Decimal("10.00")
        )
        assert order.total == Decimal("10.00")

        mock_client = _MockPlotholdersClient(
            {"BIG-50": {"code": "BIG-50", "amount": "50.00"}}
        )
        await apply_vouchers_to_order(
            db_session,
            order_id=order.id,
            codes=["BIG-50"],
            staff=cashier_staff,
            plotholders=mock_client,
        )

        await db_session.refresh(order)
        assert order.total == Decimal("0.00")
        assert mock_client.redeem_calls == ["BIG-50"]

        result = await db_session.execute(select(OrderVoucher).where(OrderVoucher.order_id == order.id))
        link = result.scalar_one()
        assert link.amount_applied == Decimal("10.00")

    @pytest.mark.skip(
        reason="SQLite test DB doesn't support SELECT ... FOR UPDATE — covered by Postgres integration tests"
    )
    async def test_concurrent_voucher_apply_only_first_succeeds(
        self, client: AsyncClient, db_session, outlet, cashier_staff, product, monkeypatch
    ) -> None:
        payload = await _create_order_payload(outlet.id, cashier_staff.id, product.id)
        order1_resp = await client.post("/api/orders", json=payload)
        order2_resp = await client.post("/api/orders", json=payload)
        assert order1_resp.status_code == 201
        assert order2_resp.status_code == 201
        order1_id = order1_resp.json()["id"]
        order2_id = order2_resp.json()["id"]

        mock_client = _MockPlotholdersClient(
            {"RACE-1": {"code": "RACE-1", "amount": "5.00"}}
        )
        monkeypatch.setattr("app.services.vouchers.PlotholdersClient", lambda: mock_client)

        async def apply(order_id: str) -> int:
            resp = await client.post(
                f"/api/orders/{order_id}/vouchers",
                json={"codes": ["RACE-1"]},
            )
            return resp.status_code

        status_codes = await asyncio.gather(apply(order1_id), apply(order2_id))

        assert status_codes.count(200) == 1
        assert status_codes.count(409) == 1
        assert mock_client.redeem_calls == ["RACE-1"]

        result = await db_session.execute(select(OrderVoucher))
        assert len(result.scalars().all()) == 1
