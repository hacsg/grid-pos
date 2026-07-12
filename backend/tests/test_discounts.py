"""Tests for discount CRUD, including product-targeted rules."""

import pytest
import pytest_asyncio
from httpx import AsyncClient


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, cashier_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {cashier_token}"


class TestCreateDiscount:
    """POST /api/discounts"""

    async def test_cart_scope_defaults(self, client: AsyncClient) -> None:
        payload = {"name": "10% Staff", "kind": "percent", "amount": 10}
        resp = await client.post("/api/discounts", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["scope"] == "cart"
        assert data["min_quantity"] == 1
        assert data["threshold_mode"] == "gate"
        assert data["target_category_ids"] == []
        assert data["target_product_ids"] == []

    async def test_targeted_with_category_and_product(
        self, client: AsyncClient, category, product
    ) -> None:
        payload = {
            "name": "3 Pints 10% Off",
            "kind": "percent",
            "amount": 10,
            "scope": "targeted",
            "min_quantity": 3,
            "threshold_mode": "gate",
            "target_category_ids": [str(category.id)],
            "target_product_ids": [str(product.id)],
        }
        resp = await client.post("/api/discounts", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["scope"] == "targeted"
        assert data["min_quantity"] == 3
        assert data["target_category_ids"] == [str(category.id)]
        assert data["target_product_ids"] == [str(product.id)]

    async def test_targeted_unknown_category_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        payload = {
            "name": "Bad target",
            "kind": "percent",
            "amount": 10,
            "scope": "targeted",
            "target_category_ids": [bogus],
        }
        resp = await client.post("/api/discounts", json=payload)
        assert resp.status_code == 404

    async def test_bad_threshold_mode_422(self, client: AsyncClient) -> None:
        payload = {
            "name": "Bad mode",
            "kind": "percent",
            "amount": 10,
            "scope": "targeted",
            "threshold_mode": "nonsense",
        }
        resp = await client.post("/api/discounts", json=payload)
        assert resp.status_code == 422


class TestUpdateDiscount:
    """PUT /api/discounts/{id}"""

    async def test_update_targets(self, client: AsyncClient, category, product) -> None:
        created = await client.post(
            "/api/discounts",
            json={
                "name": "Promo",
                "kind": "percent",
                "amount": 10,
                "scope": "targeted",
                "target_category_ids": [str(category.id)],
            },
        )
        discount_id = created.json()["id"]

        resp = await client.put(
            f"/api/discounts/{discount_id}",
            json={"target_product_ids": [str(product.id)], "target_category_ids": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["target_category_ids"] == []
        assert data["target_product_ids"] == [str(product.id)]

    async def test_list_returns_targets(self, client: AsyncClient, category) -> None:
        await client.post(
            "/api/discounts",
            json={
                "name": "Promo",
                "kind": "percent",
                "amount": 10,
                "scope": "targeted",
                "target_category_ids": [str(category.id)],
            },
        )
        resp = await client.get("/api/discounts")
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["target_category_ids"] == [str(category.id)]
