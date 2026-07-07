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
class _SharedSessionCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_args):
        return None


class _SharedSessionMaker:
    def __init__(self, session):
        self._session = session

    def __call__(self):
        return _SharedSessionCtx(self._session)


@pytest.fixture
def kpay_test_db(db_session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Route kpay router DB access through the test fixture session."""
    monkeypatch.setattr(
        "app.routers.kpay.AsyncSessionLocal",
        _SharedSessionMaker(db_session),
    )


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
    client: AsyncClient,
    db_session,
    outlet,
    cashier_staff,
    product,
    cashier_token,
    monkeypatch,
    kpay_test_db,
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


@pytest.mark.asyncio
async def test_kpay_query_success_marks_paid(
    client: AsyncClient,
    db_session,
    outlet,
    cashier_staff,
    product,
    cashier_token,
    monkeypatch,
    kpay_test_db,
) -> None:
    """POST /kpay/{id}/query with terminal success marks the order paid (2.2)."""
    order_payload = OrderCreate(
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        items=[OrderItemCreate(product_id=product.id, quantity=1)],
    )
    order = await create_order_service(db_session, order_payload)
    intent = await pi.create_payment_intent(
        session=db_session,
        outlet_id=outlet.id,
        order_id=order.id,
        amount=order.total,
    )
    await pi.update_payment_intent_status(
        session=db_session,
        intent_id=str(intent.id),
        status="timeout",
        kpay_response={"pay_result": 1},
        error_message="Card payment still pending",
    )

    ws_daemon._active_connections[str(outlet.id)] = object()

    async def fake_query(*_a, **_k):
        return {
            "type": "query_result",
            "pay_result": 2,
            "transaction_no": "TX-QUERY-OK",
            "out_trade_no": intent.out_trade_no,
        }

    monkeypatch.setattr(pi, "query_on_terminal", fake_query)

    try:
        headers = {
            "Authorization": f"Bearer {cashier_token}",
            "X-Outlet-Id": str(outlet.id),
        }
        resp = await client.post(f"/api/kpay/{intent.id}/query", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "success"
        assert body["terminal_status"] == "success"

        reloaded = await db_session.get(Order, order.id)
        assert reloaded is not None
        assert reloaded.status == OrderStatus.paid
        assert reloaded.payment_reference == "TX-QUERY-OK"
    finally:
        ws_daemon._active_connections.pop(str(outlet.id), None)


@pytest.mark.asyncio
async def test_kpay_start_requires_query_after_timeout(
    client: AsyncClient,
    db_session,
    outlet,
    cashier_staff,
    product,
    cashier_token,
    monkeypatch,
    kpay_test_db,
) -> None:
    """POST /kpay/start is blocked until the prior timeout intent is queried (2.2)."""
    order_payload = OrderCreate(
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        items=[OrderItemCreate(product_id=product.id, quantity=1)],
    )
    order = await create_order_service(db_session, order_payload)
    stale = await pi.create_payment_intent(
        session=db_session,
        outlet_id=outlet.id,
        order_id=order.id,
        amount=order.total,
    )
    await pi.update_payment_intent_status(
        session=db_session,
        intent_id=str(stale.id),
        status="timeout",
        kpay_response={"pay_result": 1},
        error_message="Card payment still pending",
    )

    ws_daemon._active_connections[str(outlet.id)] = object()

    async def fake_start_sale(*_a, **_k):
        return {"type": "sale_result", "pay_result": 3, "reason": "Declined"}

    monkeypatch.setattr(pi, "start_sale_on_terminal", fake_start_sale)

    try:
        headers = {
            "Authorization": f"Bearer {cashier_token}",
            "X-Outlet-Id": str(outlet.id),
        }
        resp = await client.post(
            "/api/kpay/start",
            json={"order_id": str(order.id), "amount": float(order.total)},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "Must query previous intent before retrying" in resp.json().get("detail", "")
    finally:
        ws_daemon._active_connections.pop(str(outlet.id), None)


@pytest.mark.asyncio
async def test_kpay_start_allowed_after_query(
    client: AsyncClient,
    db_session,
    outlet,
    cashier_staff,
    product,
    cashier_token,
    monkeypatch,
    kpay_test_db,
) -> None:
    """After querying a timeout intent, POST /kpay/start may create a new intent (2.2)."""
    order_payload = OrderCreate(
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        items=[OrderItemCreate(product_id=product.id, quantity=1)],
    )
    order = await create_order_service(db_session, order_payload)
    stale = await pi.create_payment_intent(
        session=db_session,
        outlet_id=outlet.id,
        order_id=order.id,
        amount=order.total,
    )
    await pi.update_payment_intent_status(
        session=db_session,
        intent_id=str(stale.id),
        status="timeout",
        kpay_response={"pay_result": 1},
        error_message="Card payment still pending",
    )

    ws_daemon._active_connections[str(outlet.id)] = object()

    async def fake_query(*_a, **_k):
        return {
            "type": "query_result",
            "pay_result": 3,
            "reason": "Declined",
            "out_trade_no": stale.out_trade_no,
        }

    async def fake_start_sale(intent, **_k):
        await pi.update_payment_intent_status(
            session=db_session,
            intent_id=str(intent.id),
            status="failed",
            error_message="Declined on retry",
        )
        return {"type": "sale_result", "pay_result": 3, "reason": "Declined"}

    monkeypatch.setattr(pi, "query_on_terminal", fake_query)
    monkeypatch.setattr(pi, "start_sale_on_terminal", fake_start_sale)

    headers = {
        "Authorization": f"Bearer {cashier_token}",
        "X-Outlet-Id": str(outlet.id),
    }

    try:
        query_resp = await client.post(f"/api/kpay/{stale.id}/query", headers=headers)
        assert query_resp.status_code == 200
        assert query_resp.json()["terminal_status"] == "failed"

        start_resp = await client.post(
            "/api/kpay/start",
            json={"order_id": str(order.id), "amount": float(order.total)},
            headers=headers,
        )
        assert start_resp.status_code == 200
        assert "id" in start_resp.json()
    finally:
        ws_daemon._active_connections.pop(str(outlet.id), None)


class TestDaemonReconciliationEndpoints:
    """Regression: these endpoints are called by the Go daemon with X-Daemon-Token.

    They previously crashed with NameError because `settings` was not imported
    in app/routers/kpay.py — nothing else exercised _ensure_daemon_token.
    """

    @pytest.mark.asyncio
    async def test_list_candidates_with_valid_token(
        self, client: AsyncClient, outlet, kpay_test_db, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "kpay_daemon_token", "test-daemon-token")
        resp = await client.get(
            "/api/kpay/reconciliation-candidates",
            headers={"X-Outlet-Id": str(outlet.id), "X-Daemon-Token": "test-daemon-token"},
        )
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_list_candidates_rejects_bad_token(
        self, client: AsyncClient, outlet, kpay_test_db, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "kpay_daemon_token", "test-daemon-token")
        resp = await client.get(
            "/api/kpay/reconciliation-candidates",
            headers={"X-Outlet-Id": str(outlet.id), "X-Daemon-Token": "wrong"},
        )
        assert resp.status_code == 401


class TestDaemonRegistryKeying:
    """The registry is keyed by string; UUID callers must still hit it.

    Regression: start_sale_on_terminal passed PaymentIntent.outlet_id (a UUID)
    to send_to_daemon, which missed the str-keyed dict and raised "Daemon not
    connected" 44ms after the router's own str-keyed check had passed.
    """

    def test_get_daemon_connection_accepts_uuid(self, outlet) -> None:
        sentinel = object()
        ws_daemon._active_connections[str(outlet.id)] = sentinel
        try:
            assert ws_daemon.get_daemon_connection(outlet.id) is sentinel
            assert ws_daemon.get_daemon_connection(str(outlet.id)) is sentinel
        finally:
            ws_daemon._active_connections.pop(str(outlet.id), None)


@pytest.mark.asyncio
async def test_kpay_status_poll_finds_intent(
    client: AsyncClient,
    db_session,
    outlet,
    cashier_staff,
    product,
    cashier_token,
    kpay_test_db,
) -> None:
    """GET /kpay/status/{id} returns the intent instead of 404.

    Regression: the outlet ownership check compared intent.outlet_id (UUID)
    to the X-Outlet-Id header (str), so every status poll 404'd and the POS
    showed 'payment intent not found' during live sales.
    """
    order_payload = OrderCreate(
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        items=[OrderItemCreate(product_id=product.id, quantity=1)],
    )
    order = await create_order_service(db_session, order_payload)
    intent = await pi.create_payment_intent(
        session=db_session,
        outlet_id=outlet.id,
        order_id=order.id,
        amount=order.total,
    )

    resp = await client.get(
        f"/api/kpay/status/{intent.id}",
        headers={
            "Authorization": f"Bearer {cashier_token}",
            "X-Outlet-Id": str(outlet.id),
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(intent.id)
    assert body["status"] == "pending"


class TestReversalAuthorization:
    """Manager-PIN gate for void/refund: cashier may initiate, PIN authorizes."""

    @pytest.mark.asyncio
    async def test_manager_authorizes_without_pin(self, db_session, manager_staff):
        from app.routers.kpay import _authorize_reversal
        who = await _authorize_reversal(db_session, manager_staff, None)
        assert who.id == manager_staff.id

    @pytest.mark.asyncio
    async def test_cashier_needs_pin(self, db_session, cashier_staff):
        from fastapi import HTTPException
        from app.routers.kpay import _authorize_reversal
        with pytest.raises(HTTPException) as exc:
            await _authorize_reversal(db_session, cashier_staff, None)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_cashier_with_valid_manager_pin(self, db_session, cashier_staff, manager_staff):
        from app.routers.kpay import _authorize_reversal
        who = await _authorize_reversal(db_session, cashier_staff, "1111")  # manager PIN
        assert who.id == manager_staff.id

    @pytest.mark.asyncio
    async def test_cashier_with_wrong_pin_rejected(self, db_session, cashier_staff, manager_staff):
        from fastapi import HTTPException
        from app.routers.kpay import _authorize_reversal
        with pytest.raises(HTTPException) as exc:
            await _authorize_reversal(db_session, cashier_staff, "9999")
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_cashier_pin_is_not_manager_pin(self, db_session, cashier_staff):
        # A valid *cashier* PIN must not authorize a reversal.
        from fastapi import HTTPException
        from app.routers.kpay import _authorize_reversal
        with pytest.raises(HTTPException) as exc:
            await _authorize_reversal(db_session, cashier_staff, "1234")  # cashier's own PIN
        assert exc.value.status_code == 403
