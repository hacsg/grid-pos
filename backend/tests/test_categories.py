"""Tests for category CRUD endpoints."""

import pytest
from httpx import AsyncClient


class TestListCategories:
    """GET /api/categories"""

    async def test_empty(self, client: AsyncClient) -> None:
        resp = await client.get("/api/categories")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_with_categories(self, client: AsyncClient, category) -> None:
        resp = await client.get("/api/categories")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Test Category"

    async def test_filter_by_outlet(self, client: AsyncClient, category, outlet) -> None:
        resp = await client.get(f"/api/categories?outlet_id={outlet.id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_filter_by_nonexistent_outlet(self, client: AsyncClient, category) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/api/categories?outlet_id={bogus}")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetCategory:
    """GET /api/categories/{id}"""

    async def test_exists(self, client: AsyncClient, category) -> None:
        resp = await client.get(f"/api/categories/{category.id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Test Category"

    async def test_not_found(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/api/categories/{bogus}")
        assert resp.status_code == 404


class TestCreateCategory:
    """POST /api/categories"""

    async def test_valid(self, client: AsyncClient, outlet) -> None:
        payload = {"name": "Beverages", "sort_order": 1, "outlet_id": str(outlet.id)}
        resp = await client.post("/api/categories", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Beverages"
        assert data["sort_order"] == 1

    async def test_global_category(self, client: AsyncClient) -> None:
        payload = {"name": "Global", "sort_order": 0}
        resp = await client.post("/api/categories", json=payload)
        assert resp.status_code == 201
        assert resp.json()["outlet_id"] is None

    async def test_nonexistent_outlet_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        payload = {"name": "Bad", "sort_order": 0, "outlet_id": bogus}
        resp = await client.post("/api/categories", json=payload)
        assert resp.status_code == 404

    async def test_invalid_payload_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post("/api/categories", json={"name": ""})
        assert resp.status_code == 422


class TestUpdateCategory:
    """PUT /api/categories/{id}"""

    async def test_update_name(self, client: AsyncClient, category) -> None:
        resp = await client.put(f"/api/categories/{category.id}", json={"name": "Updated Cat"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Cat"

    async def test_update_sort_order(self, client: AsyncClient, category) -> None:
        resp = await client.put(f"/api/categories/{category.id}", json={"sort_order": 99})
        assert resp.status_code == 200
        assert resp.json()["sort_order"] == 99

    async def test_update_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.put(f"/api/categories/{bogus}", json={"name": "Ghost"})
        assert resp.status_code == 404


class TestDeleteCategory:
    """DELETE /api/categories/{id}"""

    async def test_empty_category(self, client: AsyncClient, category) -> None:
        resp = await client.delete(f"/api/categories/{category.id}")
        assert resp.status_code == 204

        # Verify deletion.
        get_resp = await client.get(f"/api/categories/{category.id}")
        assert get_resp.status_code == 404

    async def test_category_with_products_returns_409(self, client: AsyncClient, category, product) -> None:
        resp = await client.delete(f"/api/categories/{category.id}")
        assert resp.status_code == 409
        assert "products" in resp.json()["detail"].lower()

    async def test_not_found(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.delete(f"/api/categories/{bogus}")
        assert resp.status_code == 404


class TestReorderCategories:
    """PATCH /api/categories/reorder"""

    async def test_reorder(self, client: AsyncClient, category, other_category) -> None:
        payload = {
            "items": [
                {"id": str(category.id), "sort_order": 10},
                {"id": str(other_category.id), "sort_order": 5},
            ]
        }
        resp = await client.patch("/api/categories/reorder", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        # Should be sorted by sort_order (5 first, then 10).
        assert data[0]["id"] == str(other_category.id)
        assert data[1]["id"] == str(category.id)

    async def test_nonexistent_category_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        payload = {"items": [{"id": bogus, "sort_order": 1}]}
        resp = await client.patch("/api/categories/reorder", json=payload)
        assert resp.status_code == 404