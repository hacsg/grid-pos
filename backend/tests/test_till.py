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


@pytest.mark.asyncio
async def test_movements_and_drawer_open(
    client: AsyncClient, db_session, outlet, cashier_staff, cashier_token, manager_staff, manager_token
):
    ch = {"Authorization": f"Bearer {cashier_token}"}
    mh = {"Authorization": f"Bearer {manager_token}"}
    # Open with $100 float.
    sid = (await client.post("/api/till/open", json={"outlet_id": str(outlet.id), "opening_float": "100"}, headers=ch)).json()["id"]

    # Cashier cash-out needs a manager PIN; their own PIN (1234) is rejected.
    bad = await client.post("/api/till/movement", json={"session_id": sid, "direction": "out", "amount": "20", "reason": "supplier", "manager_pin": "1234"}, headers=ch)
    assert bad.status_code == 403
    # Valid manager PIN authorizes a $20 cash-out.
    ok = await client.post("/api/till/movement", json={"session_id": sid, "direction": "out", "amount": "20", "reason": "supplier", "manager_pin": "1111"}, headers=ch)
    assert ok.status_code == 200
    # A $10 cash-in (float top-up).
    await client.post("/api/till/movement", json={"session_id": sid, "direction": "in", "amount": "10", "reason": "change", "manager_pin": "1111"}, headers=ch)

    # Manager 'current' expected = 100 - 20 + 10 = 90.
    cur = await client.get("/api/till/current", params={"outlet_id": str(outlet.id)}, headers=mh)
    assert cur.json()["expected_cash"] == "90.00"

    # Drawer open with manager PIN → ok + logged as nosale.
    d = await client.post("/api/till/drawer-open", json={"outlet_id": str(outlet.id), "manager_pin": "1111"}, headers=ch)
    assert d.status_code == 200 and d.json()["ok"] is True

    # Manager movements list has out, in, nosale.
    mv = await client.get(f"/api/till/{sid}/movements", headers=mh)
    dirs = sorted(m["direction"] for m in mv.json())
    assert dirs == ["in", "nosale", "out"]

    # Blind close counting $88 → expected 90, variance -2 (manager-only).
    close = await client.post("/api/till/close", json={"session_id": sid, "counted_cash": "88"}, headers=ch)
    assert "variance" not in close.json() or close.json().get("variance") is None
    hist = (await client.get("/api/till/sessions", params={"outlet_id": str(outlet.id)}, headers=mh)).json()[0]
    assert hist["expected_cash"] == "90.00"
    assert hist["variance"] == "-2.00"


@pytest.mark.asyncio
async def test_carry_over_links_close_to_next_open(
    client: AsyncClient, db_session, outlet, cashier_staff, cashier_token
):
    """The counted cash at close becomes the expected opening float next time."""
    headers = {"Authorization": f"Bearer {cashier_token}"}

    # First-ever open: no history, so no carry-over expectation.
    resp = await client.get("/api/till/carry-over", params={"outlet_id": str(outlet.id)}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["expected_opening_float"] is None

    resp = await client.post(
        "/api/till/open", json={"outlet_id": str(outlet.id), "opening_float": "100.00"}, headers=headers
    )
    assert resp.status_code == 200
    first = resp.json()
    assert first["expected_opening_float"] is None
    assert first["opening_variance"] is None

    # Close counting $150 — that cash stays in the drawer overnight.
    resp = await client.post(
        "/api/till/close", json={"session_id": first["id"], "counted_cash": "150.00"}, headers=headers
    )
    assert resp.status_code == 200

    # Carry-over now reports $150 expected at the next open.
    resp = await client.get("/api/till/carry-over", params={"outlet_id": str(outlet.id)}, headers=headers)
    body = resp.json()
    assert body["expected_opening_float"] == "150.00"
    assert body["previous_counted_cash"] == "150.00"
    assert body["previous_business_date"] is not None

    # Next open declares $148 → the $2 shortfall is recorded as opening variance.
    resp = await client.post(
        "/api/till/open", json={"outlet_id": str(outlet.id), "opening_float": "148.00"}, headers=headers
    )
    assert resp.status_code == 200
    second = resp.json()
    assert second["expected_opening_float"] == "150.00"
    assert second["opening_variance"] == "-2.00"


@pytest.mark.asyncio
async def test_carry_over_uses_latest_close(
    client: AsyncClient, db_session, outlet, cashier_token
):
    """With several closed sessions, the carry-over comes from the newest one."""
    headers = {"Authorization": f"Bearer {cashier_token}"}

    for counted in ("80.00", "95.00"):
        resp = await client.post(
            "/api/till/open", json={"outlet_id": str(outlet.id), "opening_float": "50.00"}, headers=headers
        )
        assert resp.status_code == 200
        resp = await client.post(
            "/api/till/close", json={"session_id": resp.json()["id"], "counted_cash": counted}, headers=headers
        )
        assert resp.status_code == 200

    resp = await client.get("/api/till/carry-over", params={"outlet_id": str(outlet.id)}, headers=headers)
    assert resp.json()["expected_opening_float"] == "95.00"
