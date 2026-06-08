"""Tests for product CRUD endpoints."""

import pytest
from httpx import AsyncClient


class TestListProducts:
    """GET /api/products"""

    async def test_empty(self, client: AsyncClient) -> None:
        resp = await client.get("/api/products")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_with_products(self, client: AsyncClient, product) -> None:
        resp = await client.get("/api/products")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Test Product"

    async def test_filter_by_category(self, client: AsyncClient, product, other_category) -> None:
        resp = await client.get(f"/api/products?category_id={other_category.id}")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_filter_by_availability(self, client: AsyncClient, product) -> None:
        resp = await client.get("/api/products?is_available=true")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = await client.get("/api/products?is_available=false")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_filter_by_outlet(self, client: AsyncClient, product, outlet) -> None:
        resp = await client.get(f"/api/products?outlet_id={outlet.id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_filter_by_nonexistent_outlet(self, client: AsyncClient, product) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/api/products?outlet_id={bogus}")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetProduct:
    """GET /api/products/{id}"""

    async def test_exists(self, client: AsyncClient, product) -> None:
        resp = await client.get(f"/api/products/{product.id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Test Product"

    async def test_not_found(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/api/products/{bogus}")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    async def test_includes_category(self, client: AsyncClient, product) -> None:
        resp = await client.get(f"/api/products/{product.id}")
        assert resp.status_code == 200
        assert resp.json()["category"]["name"] == "Test Category"

    async def test_includes_modifier_groups(self, client: AsyncClient, product, modifier_group, product_modifier_assignment) -> None:
        resp = await client.get(f"/api/products/{product.id}")
        assert resp.status_code == 200
        mgs = resp.json()["modifier_groups"]
        assert len(mgs) == 1
        assert mgs[0]["group_name"] == "Size"


class TestCreateProduct:
    """POST /api/products"""

    async def test_valid(self, client: AsyncClient, category) -> None:
        payload = {"name": "New Product", "price": "12.50", "category_id": str(category.id)}
        resp = await client.post("/api/products", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "New Product"
        assert data["is_available"] is True

    async def test_missing_category_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        payload = {"name": "Orphan", "price": "5.00", "category_id": bogus}
        resp = await client.post("/api/products", json=payload)
        assert resp.status_code == 404

    async def test_invalid_payload_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post("/api/products", json={"name": ""})
        assert resp.status_code == 422


class TestUpdateProduct:
    """PUT /api/products/{id}"""

    async def test_update_name(self, client: AsyncClient, product) -> None:
        resp = await client.put(f"/api/products/{product.id}", json={"name": "Updated Name"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"

    async def test_update_price(self, client: AsyncClient, product) -> None:
        resp = await client.put(f"/api/products/{product.id}", json={"price": "29.99"})
        assert resp.status_code == 200
        # SQLite returns Decimal as string; asyncpg returns numeric.
        assert str(resp.json()["price"]) == "29.99"

    async def test_update_category(self, client: AsyncClient, product, other_category) -> None:
        resp = await client.put(
            f"/api/products/{product.id}", json={"category_id": str(other_category.id)}
        )
        assert resp.status_code == 200
        assert resp.json()["category"]["name"] == "Other Category"

    async def test_update_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.put(f"/api/products/{bogus}", json={"name": "Ghost"})
        assert resp.status_code == 404

    async def test_update_nonexistent_category_returns_404(self, client: AsyncClient, product) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.put(f"/api/products/{product.id}", json={"category_id": bogus})
        assert resp.status_code == 404


class TestDeleteProduct:
    """DELETE /api/products/{id} — soft delete"""

    async def test_soft_delete(self, client: AsyncClient, product) -> None:
        resp = await client.delete(f"/api/products/{product.id}")
        assert resp.status_code == 204

        # Verify is_available is now False.
        get_resp = await client.get(f"/api/products/{product.id}")
        assert get_resp.json()["is_available"] is False

    async def test_not_found(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.delete(f"/api/products/{bogus}")
        assert resp.status_code == 404


class TestToggleAvailability:
    """PATCH /api/products/{id}/availability"""

    async def test_toggle_off(self, client: AsyncClient, product) -> None:
        resp = await client.patch(
            f"/api/products/{product.id}/availability", json={"is_available": False}
        )
        assert resp.status_code == 200
        assert resp.json()["is_available"] is False

    async def test_toggle_on(self, client: AsyncClient, product) -> None:
        # First toggle off
        await client.patch(f"/api/products/{product.id}/availability", json={"is_available": False})
        # Then toggle on
        resp = await client.patch(
            f"/api/products/{product.id}/availability", json={"is_available": True}
        )
        assert resp.status_code == 200
        assert resp.json()["is_available"] is True

    async def test_not_found(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.patch(f"/api/products/{bogus}/availability", json={"is_available": False})
        assert resp.status_code == 404

    async def test_invalid_payload_returns_422(self, client: AsyncClient, product) -> None:
        resp = await client.patch(
            f"/api/products/{product.id}/availability", json={"is_available": None}
        )
        assert resp.status_code == 422