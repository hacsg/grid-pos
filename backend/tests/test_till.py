"""Till session tests: open float, blind close, manager-only variance."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from httpx import AsyncClient

from app.models.order import Order, OrderStatus


async def _paid_cash_order(db, outlet, staff, *, total, tendered, change):
    o = Order(
        order_number="9001",
        outlet_id=outlet.id,
        staff_id=staff.id,
        subtotal=Decimal(str(total)),
        total=Decimal(str(total)),
        status=OrderStatus.paid,
        payment_method="cash",
        cash_tendered=Decimal(str(tendered)),
        cash_change=Decimal(str(change)),
        created_at=datetime.now(UTC),
    )
    db.add(o)
    await db.commit()
    return o


@pytest.mark.asyncio
async def test_open_close_blind_and_variance(
    client: AsyncClient, db_session, outlet, cashier_staff, cashier_token, manager_token
):
    headers = {"Authorization": f"Bearer {cashier_token}"}

    # No till open yet.
    resp = await client.get("/api/till/current", params={"outlet_id": str(outlet.id)}, headers=headers)
    assert resp.status_code == 200 and resp.json() is None

    # Open with a $100 float.
    resp = await client.post("/api/till/open", json={"outlet_id": str(outlet.id), "opening_float": "100.00"}, headers=headers)
    assert resp.status_code == 200
    session_id = resp.json()["id"]
    assert resp.json()["opening_float"] == "100.00"

    # Cannot open a second till.
    resp = await client.post("/api/till/open", json={"outlet_id": str(outlet.id), "opening_float": "50"}, headers=headers)
    assert resp.status_code == 409

    # A $20 cash sale, $50 tendered, $30 change → $20 kept.
    await _paid_cash_order(db_session, outlet, cashier_staff, total=20, tendered=50, change=30)

    # Blind close: cashier counts $118 (short by $2 vs expected 100+20=120).
    resp = await client.post("/api/till/close", json={"session_id": session_id, "counted_cash": "118.00"}, headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    # Blind: the cashier's response must NOT reveal expected or variance.
    assert "expected_cash" not in body or body.get("expected_cash") is None
    assert "variance" not in body or body.get("variance") is None
    assert body["counted_cash"] == "118.00"
    assert body["status"] == "closed"

    # Manager history shows the reconciliation.
    mgr = {"Authorization": f"Bearer {manager_token}"}
    resp = await client.get("/api/till/sessions", params={"outlet_id": str(outlet.id)}, headers=mgr)
    assert resp.status_code == 200
    sess = resp.json()[0]
    assert sess["expected_cash"] == "120.00"
    assert sess["variance"] == "-2.00"


@pytest.mark.asyncio
async def test_cashier_cannot_list_sessions(client: AsyncClient, outlet, cashier_token):
    resp = await client.get(
        "/api/till/sessions",
        params={"outlet_id": str(outlet.id)},
        headers={"Authorization": f"Bearer {cashier_token}"},
    )
    assert resp.status_code == 403
