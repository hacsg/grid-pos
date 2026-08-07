"""Tests for the Plotholders HTTP client."""

from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

from app.services.plotholders_client import PlotholdersClient


@pytest.mark.asyncio
async def test_lookup_by_phone_returns_first_customer() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"customers": [{"id": "cus_1", "phone": "91234567"}]},
        )

    client = PlotholdersClient(
        base_url="https://plotholders.test",
        transport=httpx.MockTransport(handler),
    )

    customer = await client.lookup_by_phone("91234567")

    assert customer == {"id": "cus_1", "phone": "91234567"}
    assert requests[0].url.path == "/api/customers"
    assert requests[0].url.params["phone"] == "+6591234567"


@pytest.mark.asyncio
async def test_lookup_by_referral_code_uses_supported_query() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["referral_code"] == "ABC123"
        return httpx.Response(
            200,
            json={"customers": [{"id": "cus_2", "referral_code": "ABC123"}]},
        )

    client = PlotholdersClient(
        base_url="https://plotholders.test",
        transport=httpx.MockTransport(handler),
    )

    customer = await client.lookup_by_referral_code("ABC123")

    assert customer == {"id": "cus_2", "referral_code": "ABC123"}


@pytest.mark.asyncio
async def test_lookup_by_referral_code_falls_back_and_filters() -> None:
    seen_params: list[dict[str, str]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_params.append(dict(request.url.params))
        if "referral_code" in request.url.params:
            return httpx.Response(422, json={"detail": "unsupported query"})
        return httpx.Response(
            200,
            json=[
                {"id": "cus_other", "referral_code": "NOPE99"},
                {"id": "cus_match", "referral_code": "ABC123"},
            ],
        )

    client = PlotholdersClient(
        base_url="https://plotholders.test",
        transport=httpx.MockTransport(handler),
    )

    customer = await client.lookup_by_referral_code("ABC123")

    assert customer == {"id": "cus_match", "referral_code": "ABC123"}
    assert seen_params == [
        {"referral_code": "ABC123"},
        {"phone": "ABC123"},
    ]


@pytest.mark.asyncio
async def test_create_customer_omits_empty_optional_fields() -> None:
    captured_json: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured_json.update(httpx.Request("POST", request.url, content=request.content).read())
        return httpx.Response(201, json={"id": "cus_3", "phone": "91234567"})

    def sync_handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_json
        captured_json = dict(__import__("json").loads(request.content.decode()))
        return httpx.Response(201, json={"id": "cus_3", "phone": "91234567"})

    client = PlotholdersClient(
        base_url="https://plotholders.test",
        transport=httpx.MockTransport(sync_handler),
    )

    customer = await client.create_customer(
        phone="91234567",
        name="Jane",
        email=None,
        birthday="1990-01-01",
    )

    assert customer["id"] == "cus_3"
    assert captured_json == {
        "phone": "+6591234567",
        "name": "Jane",
        "birthday": "1990-01-01",
    }


@pytest.mark.asyncio
async def test_record_purchase_posts_grid_moment_payload() -> None:
    order_id = uuid4()
    captured_json: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_json
        captured_json = dict(__import__("json").loads(request.content.decode()))
        return httpx.Response(200, json={"id": "moment_1"})

    client = PlotholdersClient(
        base_url="https://plotholders.test",
        transport=httpx.MockTransport(handler),
    )

    result = await client.record_purchase(
        customer_id="cus_1",
        order_id=order_id,
        amount=Decimal("18.98"),
        outlet="Test Outlet",
    )

    assert result == {"id": "moment_1"}
    # A moment is one visit: amount is always 1, the dollar total rides along as
    # order_total (analytics only), and source_id=order id keeps it idempotent.
    assert captured_json == {
        "customer_id": "cus_1",
        "channel": "grid",
        "source_id": str(order_id),
        "amount": 1,
        "order_total": 18.98,
        "reason": "visit",
        "outlet": "Test Outlet",
        "brand": "hundred-acre",
    }


@pytest.mark.asyncio
async def test_redeem_voucher_and_reward_paths() -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(200, json={"status": "redeemed"})

    client = PlotholdersClient(
        base_url="https://plotholders.test",
        transport=httpx.MockTransport(handler),
    )

    assert await client.redeem_voucher("voucher_1") == {"status": "redeemed"}
    assert await client.redeem_reward("reward_1") == {"status": "redeemed"}
    assert paths == [
        "/api/vouchers/voucher_1/redeem",
        "/api/rewards/reward_1/redeem",
    ]


@pytest.mark.asyncio
async def test_activate_gift_card_posts_code_staff_and_outlet() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured
        captured = {
            "path": request.url.path,
            "method": request.method,
            "json": dict(__import__("json").loads(request.content.decode())),
        }
        return httpx.Response(
            200,
            json={
                "code": "GIFT-50",
                "value": 50,
                "status": "active",
            },
        )

    client = PlotholdersClient(
        base_url="https://plotholders.test",
        transport=httpx.MockTransport(handler),
    )

    result = await client.activate_gift_card("GIFT-50", "staff-1", "Test Outlet")

    assert result["status"] == "active"
    assert captured["path"] == "/api/gifts/activate"
    assert captured["method"] == "POST"
    assert captured["json"] == {
        "code": "GIFT-50",
        "staff_id": "staff-1",
        "outlet": "Test Outlet",
    }
