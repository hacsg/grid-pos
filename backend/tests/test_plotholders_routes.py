"""Tests for Plotholders-backed loyalty proxy routes."""

from typing import Any

import pytest_asyncio
from httpx import AsyncClient

from app.main import app
from app.routers.loyalty import get_plotholders_client


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
