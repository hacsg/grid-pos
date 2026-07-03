"""Unit tests for KPay payment helpers (money + result interpretation)."""

from decimal import Decimal
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.config import settings
from app.models.order import Order, OrderStatus
from app.routers import ws_daemon
from app.schemas.order import OrderCreate, OrderItemCreate
from app.services import payment_intents as pi
from app.services.orders import create_order as create_order_service


class TestToCents:
    def test_exact(self) -> None:
        assert pi._to_cents(Decimal("10.00")) == 1000

    def test_no_float_rounding_error(self) -> None:
        # 19.99 * 100 in float is 1998.9999...; Decimal path must give 1999.
        assert pi._to_cents(Decimal("19.99")) == 1999

    def test_half_up(self) -> None:
        assert pi._to_cents(Decimal("0.005")) == 1


class TestIsApproved:
    def test_success_code_is_two_per_spec(self) -> None:
        # KPOS LAN spec payResult: 1=pending, 2=successful.
        assert settings.kpay_payresult_success == 2
        assert pi._is_approved({"pay_result": 2}) is True
        assert pi._is_approved({"pay_result": 1}) is False  # pending, not success

    def test_matches_configured_success_code(self) -> None:
        assert pi._is_approved({"pay_result": settings.kpay_payresult_success}) is True

    def test_string_success_code(self) -> None:
        assert pi._is_approved({"pay_result": str(settings.kpay_payresult_success)}) is True

    def test_non_success_code(self) -> None:
        assert pi._is_approved({"pay_result": settings.kpay_payresult_success + 99}) is False

    def test_missing_or_garbage(self) -> None:
        assert pi._is_approved({}) is False
        assert pi._is_approved({"pay_result": "abc"}) is False


class TestNormalizeSaleResult:
    def test_extracts_persisted_fields(self) -> None:
        event = {
            "type": "sale_result",
            "request_id": "r1",
            "out_trade_no": "KPAY-1",
            "transaction_no": "TXN-1",
            "ref_no": "REF-1",
            "pay_method": 3,
            "pay_result": 1,
            "reason": "Insufficient funds",
            "extra": "ignored",
        }
        result = pi._normalize_sale_result(event)
        assert result == {
            "out_trade_no": "KPAY-1",
            "transaction_no": "TXN-1",
            "ref_no": "REF-1",
            "pay_method": 3,
            "pay_result": 1,
            "reason": "Insufficient funds",
        }


class TestNewOutTradeNo:
    def test_prefix_and_uniqueness(self) -> None:
        a = pi.new_out_trade_no("VOID")
        b = pi.new_out_trade_no("VOID")
        assert a.startswith("VOID-")
        assert a != b


@pytest.mark.asyncio
async def test_kpay_start_rejects_amount_mismatch(
    client: AsyncClient, db_session, outlet, cashier_staff, product, cashier_token, monkeypatch
) -> None:
    """KPay start must reject when client amount != server order.total (1.2c)."""
    headers = {"Authorization": f"Bearer {cashier_token}"}
    # Create via service (visible to our monkey patch below)
    order_payload = OrderCreate(
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        items=[OrderItemCreate(product_id=product.id, quantity=1)],
    )
    order = await create_order_service(db_session, order_payload)
    order_id = str(order.id)

    # Fake a connected daemon to pass the early 503 check.
    ws_daemon._active_connections[str(outlet.id)] = object()

    # Patch get_active so we don't need payment_intents table.
    async def fake_get_active(*a, **k):
        return None
    monkeypatch.setattr(pi, "get_active_intent_for_order", fake_get_active)

    # Patch AsyncSession.get so that when kpay code does session.get(Order, ...) we return
    # the real order object (avoids in-mem sqlite isolation + table issues for this test).
    from sqlalchemy.ext.asyncio import AsyncSession
    real_get = AsyncSession.get

    async def patched_get(self, model, ident, **kw):
        if model is Order and (str(ident) == order_id or ident == order.id):
            return order
        return await real_get(self, model, ident, **kw)
    monkeypatch.setattr(AsyncSession, "get", patched_get)

    try:
        k_headers = {**headers, "X-Outlet-Id": str(outlet.id)}
        resp = await client.post(
            "/api/kpay/start",
            json={"order_id": order_id, "amount": 0.01},
            headers=k_headers,
        )
        assert resp.status_code == 400
        assert "Payment amount does not match order total" in resp.json().get("detail", "")
    finally:
        ws_daemon._active_connections.pop(str(outlet.id), None)


@pytest.mark.asyncio
async def test_terminal_success_marks_order_paid(db_session, outlet, cashier_staff, product) -> None:
    """Simulate terminal success handler marks the order paid server-side (no PUT /status needed, 2.3)."""
    # Create order directly via service (bypasses any client status)
    order_payload = OrderCreate(
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        items=[OrderItemCreate(product_id=product.id, quantity=1)],
    )
    order = await create_order_service(db_session, order_payload)
    assert order.status == OrderStatus.pending
    assert str(order.total) == "9.99"

    # Create a payment intent for the full server total (pass native UUID for sqlite binding)
    intent = await pi.create_payment_intent(
        session=db_session,
        outlet_id=outlet.id,
        order_id=order.id,
        amount=order.total,
    )

    # Simulate the terminal success path (called from finalize_sale on pay_result success)
    await pi.update_payment_intent_status(
        session=db_session,
        intent_id=str(intent.id),
        status="success",
        kpay_response={"transaction_no": "TX-SIM-001"},
    )

    # Verify order was auto-marked paid by the backend
    reloaded = await db_session.get(Order, order.id)
    assert reloaded is not None
    assert reloaded.status == OrderStatus.paid
    assert reloaded.payment_method == "card"
    assert reloaded.payment_reference == "TX-SIM-001"
