"""Tests for Plotholders-backed loyalty proxy routes and gift-card voucher guards."""

from decimal import Decimal
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.main import app
from app.models.order import Order
from app.models.voucher import OrderVoucher
from app.routers.loyalty import get_plotholders_client
from app.routers import vouchers as vouchers_router
from app.schemas.order import OrderCreate, OrderItemCreate
from app.services.orders import create_order as create_order_service
from app.services.plotholders_client import PlotholdersAPIError
from app.services.vouchers import apply_vouchers_to_order


class FakePlotholdersClient:
    async def lookup_by_phone(self, phone: str) -> dict[str, Any] | None:
        # Support both legacy raw sentinel (if ever passed) and the normalized E.164 form
        if phone in ("00000000", "99999999", "+6599999999"):
            return None
        return {
            "id": "cus_1",
            "name": "Sarah Lim",
            "phone": phone,
            "tier": "gold",
            "lifetime_moments": 12,
        }

    async def lookup_by_referral_code(self, code: str) -> dict[str, Any] | None:
        return {
            "id": "cus_2",
            "name": "Referral Customer",
            "phone": "91234567",
            "referral_code": code,
        }

    async def create_customer(self, **payload: Any) -> dict[str, Any]:
        return {"id": "cus_new", **payload}

    async def redeem_voucher(self, voucher_id: str) -> dict[str, Any]:
        return {"id": voucher_id, "status": "redeemed", "type": "voucher"}

    async def redeem_reward(self, reward_id: str) -> dict[str, Any]:
        return {"id": reward_id, "status": "redeemed", "type": "reward"}


class FakeVoucherPlotholdersClient:
    """Stub Plotholders for voucher validate / apply / gift-card activate routes."""

    def __init__(
        self,
        *,
        vouchers_by_code: dict[str, dict[str, Any]] | None = None,
        activate_result: dict[str, Any] | None = None,
        activate_error: PlotholdersAPIError | None = None,
    ) -> None:
        self.vouchers_by_code = vouchers_by_code or {}
        self.activate_result = activate_result
        self.activate_error = activate_error
        self.activate_calls: list[tuple[str, str, str]] = []
        self.redeem_calls: list[str] = []

    async def get_voucher(self, voucher_ref: str) -> dict[str, Any] | None:
        return self.vouchers_by_code.get(voucher_ref.strip())

    async def redeem_voucher_by_code(self, code: str, staff_id: str, outlet: str) -> dict[str, Any]:
        self.redeem_calls.append(code)
        return {"status": "redeemed", "code": code}

    async def activate_gift_card(self, code: str, staff_id: str, outlet: str) -> dict[str, Any]:
        self.activate_calls.append((code, staff_id, outlet))
        if self.activate_error is not None:
            raise self.activate_error
        if self.activate_result is not None:
            return self.activate_result
        return {
            "code": code,
            "value": 50,
            "status": "active",
            "expires_at": None,
        }


def _override_plotholders_client() -> FakePlotholdersClient:
    return FakePlotholdersClient()


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, cashier_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {cashier_token}"


async def test_get_lookup_by_phone_proxies_to_plotholders(client: AsyncClient) -> None:
    app.dependency_overrides[get_plotholders_client] = _override_plotholders_client

    resp = await client.get("/api/loyalty/lookup?phone=91234567")

    assert resp.status_code == 200
    assert resp.json()["id"] == "cus_1"
    assert resp.json()["tier"] == "gold"


async def test_get_lookup_by_referral_code_proxies_to_plotholders(client: AsyncClient) -> None:
    app.dependency_overrides[get_plotholders_client] = _override_plotholders_client

    resp = await client.get("/api/loyalty/lookup?referral_code=ABC123")

    assert resp.status_code == 200
    assert resp.json()["id"] == "cus_2"
    assert resp.json()["referral_code"] == "ABC123"


async def test_get_lookup_requires_one_identifier(client: AsyncClient) -> None:
    app.dependency_overrides[get_plotholders_client] = _override_plotholders_client

    resp = await client.get("/api/loyalty/lookup")

    assert resp.status_code == 400
    assert "exactly one" in resp.json()["detail"]


async def test_get_lookup_returns_404_when_customer_missing(client: AsyncClient) -> None:
    app.dependency_overrides[get_plotholders_client] = _override_plotholders_client

    # Use a valid SG phone format; router will normalize to E.164 before calling the client
    resp = await client.get("/api/loyalty/lookup?phone=99999999")

    assert resp.status_code == 404
    assert resp.json()["detail"]["signup_available"] is True


async def test_signup_with_plotholders_fields_proxies_to_plotholders(client: AsyncClient) -> None:
    app.dependency_overrides[get_plotholders_client] = _override_plotholders_client

    resp = await client.post(
        "/api/loyalty/signup",
        json={
            "phone": "91234567",
            "email": "sarah@example.com",
            "name": "Sarah Lim",
            "birthday": "1990-01-01",
            "referred_by_code": "ABC123",
        },
    )

    assert resp.status_code == 201
    assert resp.json()["id"] == "cus_new"
    assert resp.json()["referred_by_code"] == "ABC123"


async def test_redeem_voucher_proxies_to_plotholders(client: AsyncClient) -> None:
    app.dependency_overrides[get_plotholders_client] = _override_plotholders_client

    resp = await client.post("/api/loyalty/redeem-voucher/voucher_1")

    assert resp.status_code == 200
    assert resp.json() == {"id": "voucher_1", "status": "redeemed", "type": "voucher"}


async def test_redeem_reward_proxies_to_plotholders(client: AsyncClient) -> None:
    app.dependency_overrides[get_plotholders_client] = _override_plotholders_client

    resp = await client.post("/api/loyalty/redeem-reward/reward_1")

    assert resp.status_code == 200
    assert resp.json() == {"id": "reward_1", "status": "redeemed", "type": "reward"}


# ---------------------------------------------------------------------------
# Physical gift cards — spendable guard + activation (money-safety)
# ---------------------------------------------------------------------------


async def test_validate_inactive_gift_card_returns_409(client: AsyncClient) -> None:
    """Unactivated physical gift cards must not validate as spendable vouchers."""
    fake = FakeVoucherPlotholdersClient(
        vouchers_by_code={
            "GIFT-INACTIVE": {
                "id": "v_inactive",
                "code": "GIFT-INACTIVE",
                "kind": "amount_off",
                "source": "gift",
                "status": "inactive",
                "value": 50,
            }
        }
    )
    app.dependency_overrides[vouchers_router.get_plotholders_client] = lambda: fake

    resp = await client.post("/api/vouchers/validate", json={"code": "GIFT-INACTIVE"})

    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert "activat" in detail.lower()


async def test_validate_active_gift_card_returns_is_gift_card(
    client: AsyncClient,
) -> None:
    fake = FakeVoucherPlotholdersClient(
        vouchers_by_code={
            "GIFT-ACTIVE": {
                "id": "v_active",
                "code": "GIFT-ACTIVE",
                "kind": "amount_off",
                "source": "gift",
                "status": "active",
                "value": 50,
            }
        }
    )
    app.dependency_overrides[vouchers_router.get_plotholders_client] = lambda: fake

    resp = await client.post("/api/vouchers/validate", json={"code": "GIFT-ACTIVE"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_gift_card"] is True
    assert data["source"] == "gift"
    assert data["status"] == "active"
    assert data["kind"] == "amount_off"
    assert float(data["amount"]) == 50.0
    assert data["is_valid"] is True


async def test_apply_inactive_gift_card_does_not_write_order_voucher(
    db_session, outlet, cashier_staff, product
) -> None:
    """Free-money regression: inactive card must not create OrderVoucher or change total."""
    product.price = Decimal("50.00")
    await db_session.commit()
    await db_session.refresh(product)

    order = await create_order_service(
        db_session,
        OrderCreate(
            outlet_id=outlet.id,
            staff_id=cashier_staff.id,
            items=[OrderItemCreate(product_id=product.id, quantity=1)],
        ),
    )
    original_total = order.total
    assert original_total == Decimal("50.00")

    fake = FakeVoucherPlotholdersClient(
        vouchers_by_code={
            "GIFT-INACTIVE": {
                "id": "v_inactive",
                "code": "GIFT-INACTIVE",
                "kind": "amount_off",
                "source": "gift",
                "status": "inactive",
                "value": 50,
            }
        }
    )

    with pytest.raises(Exception) as exc_info:
        await apply_vouchers_to_order(
            db_session,
            order_id=order.id,
            codes=["GIFT-INACTIVE"],
            staff=cashier_staff,
            plotholders=fake,
        )

    assert exc_info.value.status_code == 409
    assert "activat" in str(exc_info.value.detail).lower()
    assert fake.redeem_calls == []

    # Re-load order; total must be unchanged and no OrderVoucher row exists.
    reloaded = await db_session.get(Order, order.id)
    assert reloaded is not None
    assert reloaded.total == original_total

    result = await db_session.execute(
        select(OrderVoucher).where(OrderVoucher.order_id == order.id)
    )
    assert result.scalars().all() == []


async def test_activate_gift_card_success(client: AsyncClient, cashier_staff) -> None:
    fake = FakeVoucherPlotholdersClient(
        activate_result={
            "code": "GIFT-50",
            "value": 50,
            "status": "active",
            "expires_at": None,
        }
    )
    app.dependency_overrides[vouchers_router.get_plotholders_client] = lambda: fake

    resp = await client.post(
        "/api/vouchers/gift-cards/activate",
        json={"code": "GIFT-50"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["code"] == "GIFT-50"
    assert float(data["amount"]) == 50.0
    assert data["status"] == "active"
    assert len(fake.activate_calls) == 1
    code, staff_id, outlet = fake.activate_calls[0]
    assert code == "GIFT-50"
    assert staff_id == str(cashier_staff.id)
    assert outlet  # staff's outlet name or id


async def test_activate_gift_card_passes_through_409(client: AsyncClient) -> None:
    fake = FakeVoucherPlotholdersClient(
        activate_error=PlotholdersAPIError(
            "already activated",
            status_code=409,
            response_body={"detail": "Gift card already activated"},
        )
    )
    app.dependency_overrides[vouchers_router.get_plotholders_client] = lambda: fake

    resp = await client.post(
        "/api/vouchers/gift-cards/activate",
        json={"code": "GIFT-USED"},
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == {"detail": "Gift card already activated"}


class FakeMemberVoucherPlotholdersClient:
    """Returns raw Plotholders voucher rows — which carry `source`, not `is_gift_card`."""

    async def get_customer(self, customer_id: str) -> dict[str, Any]:
        return {"id": customer_id, "name": "Sarah Lim", "phone": "+6591234567", "tier": "gold"}

    async def list_customer_vouchers(self, customer_id: str, status: str = "active") -> list[dict[str, Any]]:
        return [
            {"id": "v1", "code": "FREES-ABC123", "title": "Free Scoop", "kind": "free_item", "source": "birthday"},
            {"id": "v2", "code": "GIFTKDUQWZFM", "title": "Acre Gift Card", "kind": "amount_off", "source": "gift", "value": 50},
        ]


async def test_member_voucher_list_flags_gift_cards(client: AsyncClient) -> None:
    """A cash-value gift card in a member's wallet must be flagged to the POS.

    The Scanner keys its "apply at checkout, don't burn it" guard off
    is_gift_card. Plotholders' rows don't carry that field, so if the route
    passes them through untouched the flag reads as false and the POS offers a
    one-tap Redeem that consumes the whole card with no sale attached.
    """
    fake = FakeMemberVoucherPlotholdersClient()
    app.dependency_overrides[get_plotholders_client] = lambda: fake

    resp = await client.get("/api/loyalty/customer/cus_1")

    assert resp.status_code == 200
    vouchers = {v["code"]: v for v in resp.json()["vouchers"]}
    assert vouchers["GIFTKDUQWZFM"]["is_gift_card"] is True
    assert vouchers["FREES-ABC123"]["is_gift_card"] is False

    app.dependency_overrides.pop(get_plotholders_client, None)


async def test_applying_a_voucher_records_the_amount_on_the_order(
    db_session, outlet, cashier_staff, product
) -> None:
    """The order must say what the voucher took off, not just carry a smaller total.

    Regression: apply_vouchers_to_order discounted the total but left
    voucher_amount at zero, so an order showed a subtotal and a smaller total
    with nothing to explain the gap — and reports, receipts and the GTO payment
    split all read voucher_amount.
    """
    product.price = Decimal("18.50")
    await db_session.commit()
    await db_session.refresh(product)

    order = await create_order_service(
        db_session,
        OrderCreate(
            outlet_id=outlet.id,
            staff_id=cashier_staff.id,
            items=[OrderItemCreate(product_id=product.id, quantity=1)],
        ),
    )
    assert order.voucher_amount == Decimal("0.00")

    fake = FakeVoucherPlotholdersClient(
        vouchers_by_code={
            "SSCSIGNCCP-TEST01": {
                "id": "v_gift",
                "code": "SSCSIGNCCP-TEST01",
                "kind": "amount_off",
                "source": "gift",
                "status": "active",
                "value": 3.5,
            }
        }
    )

    await apply_vouchers_to_order(
        db_session,
        order_id=order.id,
        codes=["SSCSIGNCCP-TEST01"],
        staff=cashier_staff,
        plotholders=fake,
    )

    reloaded = await db_session.get(Order, order.id)
    assert reloaded is not None
    assert reloaded.total == Decimal("15.00")
    assert reloaded.voucher_amount == Decimal("3.50")
    # The stated discount must always explain the gap between subtotal and total.
    assert reloaded.subtotal - reloaded.voucher_amount == reloaded.total


async def test_order_detail_reports_which_vouchers_were_used(
    client: AsyncClient, db_session, outlet, cashier_staff, cashier_token, product
) -> None:
    """GET /orders/{id} must name the vouchers applied, not just a smaller total.

    The route returned the bare order, leaving applied_vouchers null, so the
    only trace of a voucher in the detail view was an unexplained gap between
    subtotal and total.
    """
    product.price = Decimal("18.50")
    await db_session.commit()
    await db_session.refresh(product)

    order = await create_order_service(
        db_session,
        OrderCreate(
            outlet_id=outlet.id,
            staff_id=cashier_staff.id,
            items=[OrderItemCreate(product_id=product.id, quantity=1)],
        ),
    )
    fake = FakeVoucherPlotholdersClient(
        vouchers_by_code={
            "SSCSIGNCCP-TEST02": {
                "id": "v_gift2",
                "code": "SSCSIGNCCP-TEST02",
                "kind": "amount_off",
                "source": "gift",
                "status": "active",
                "value": 3.5,
            }
        }
    )
    await apply_vouchers_to_order(
        db_session,
        order_id=order.id,
        codes=["SSCSIGNCCP-TEST02"],
        staff=cashier_staff,
        plotholders=fake,
    )

    resp = await client.get(
        f"/api/orders/{order.id}",
        headers={"Authorization": f"Bearer {cashier_token}"},
    )
    assert resp.status_code == 200
    body = resp.json()

    assert [v["code"] for v in body["applied_vouchers"]] == ["SSCSIGNCCP-TEST02"]
    assert float(body["voucher_discount"]) == 3.5
    assert float(body["voucher_amount"]) == 3.5
    # The line items must be nameable without a second lookup.
    assert body["items"][0]["product_name"] == product.name
