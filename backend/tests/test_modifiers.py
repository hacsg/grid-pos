"""Tests for modifier group and modifier CRUD endpoints."""

import pytest
from httpx import AsyncClient


# =========================================================================
# Modifier Groups
# =========================================================================


class TestCreateProductModifierGroup:
    """POST /api/products/{product_id}/modifier-groups"""

    async def test_valid(self, client: AsyncClient, product) -> None:
        payload = {"name": "Extras", "required": False, "min_select": 0, "max_select": 3}
        resp = await client.post(f"/api/products/{product.id}/modifier-groups", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Extras"
        assert data["max_select"] == 3

    async def test_nonexistent_product_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        payload = {"name": "Ghost Group"}
        resp = await client.post(f"/api/products/{bogus}/modifier-groups", json=payload)
        assert resp.status_code == 404

    async def test_invalid_payload_returns_422(self, client: AsyncClient, product) -> None:
        resp = await client.post(
            f"/api/products/{product.id}/modifier-groups",
            json={"name": "Bad", "min_select": 5, "max_select": 2},
        )
        assert resp.status_code == 422


class TestUpdateModifierGroup:
    """PUT /api/modifier-groups/{id}"""

    async def test_update_name(self, client: AsyncClient, modifier_group) -> None:
        resp = await client.put(
            f"/api/modifier-groups/{modifier_group.id}", json={"name": "Updated Group"}
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Group"

    async def test_update_bounds(self, client: AsyncClient, modifier_group) -> None:
        resp = await client.put(
            f"/api/modifier-groups/{modifier_group.id}",
            json={"min_select": 1, "max_select": 5},
        )
        assert resp.status_code == 200
        assert resp.json()["min_select"] == 1
        assert resp.json()["max_select"] == 5

    async def test_min_exceeds_max_returns_400(self, client: AsyncClient, modifier_group) -> None:
        # Pydantic skips validation when only one bound is provided;
        # the router catches the conflict with the existing value.
        resp = await client.put(
            f"/api/modifier-groups/{modifier_group.id}",
            json={"min_select": 5},
        )
        assert resp.status_code == 400

    async def test_required_with_zero_min_returns_400(self, client: AsyncClient, modifier_group) -> None:
        # Only sending `required` — the router checks existing min_select.
        resp = await client.put(
            f"/api/modifier-groups/{modifier_group.id}",
            json={"required": True},
        )
        assert resp.status_code == 400

    async def test_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.put(f"/api/modifier-groups/{bogus}", json={"name": "Ghost"})
        assert resp.status_code == 404


class TestDeleteModifierGroup:
    """DELETE /api/modifier-groups/{id}"""

    async def test_delete_with_modifiers(self, client: AsyncClient, modifier_group) -> None:
        resp = await client.delete(f"/api/modifier-groups/{modifier_group.id}")
        assert resp.status_code == 204

        # Verify the group is gone by trying to delete again.
        resp2 = await client.delete(f"/api/modifier-groups/{modifier_group.id}")
        assert resp2.status_code == 404

    async def test_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.delete(f"/api/modifier-groups/{bogus}")
        assert resp.status_code == 404


# =========================================================================
# Modifiers
# =========================================================================


class TestCreateModifierInGroup:
    """POST /api/modifier-groups/{group_id}/modifiers"""

    async def test_valid(self, client: AsyncClient, modifier_group) -> None:
        payload = {"name": "Small", "price_adjustment": "0.00"}
        resp = await client.post(
            f"/api/modifier-groups/{modifier_group.id}/modifiers", json=payload
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Small"
        assert data["modifier_group_id"] == str(modifier_group.id)

    async def test_nonexistent_group_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        payload = {"name": "Ghost Modifier"}
        resp = await client.post(f"/api/modifier-groups/{bogus}/modifiers", json=payload)
        assert resp.status_code == 404

    async def test_invalid_payload_returns_422(self, client: AsyncClient, modifier_group) -> None:
        resp = await client.post(
            f"/api/modifier-groups/{modifier_group.id}/modifiers",
            json={"name": ""},
        )
        assert resp.status_code == 422


class TestUpdateModifier:
    """PUT /api/modifiers/{id}"""

    async def test_update_name(self, client: AsyncClient, modifier) -> None:
        resp = await client.put(
            f"/api/modifiers/{modifier.id}", json={"name": "Extra Large"}
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Extra Large"

    async def test_update_price(self, client: AsyncClient, modifier) -> None:
        resp = await client.put(
            f"/api/modifiers/{modifier.id}", json={"price_adjustment": "3.00"}
        )
        assert resp.status_code == 200
        # SQLite returns Decimal as string; asyncpg returns numeric.
        assert str(resp.json()["price_adjustment"]) == "3.00"

    async def test_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.put(f"/api/modifiers/{bogus}", json={"name": "Ghost"})
        assert resp.status_code == 404


class TestDeleteModifier:
    """DELETE /api/modifiers/{id}"""

    async def test_delete(self, client: AsyncClient, modifier) -> None:
        resp = await client.delete(f"/api/modifiers/{modifier.id}")
        assert resp.status_code == 204

        # Verify deletion by trying to delete again.
        resp2 = await client.delete(f"/api/modifiers/{modifier.id}")
        assert resp2.status_code == 404

    async def test_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.delete(f"/api/modifiers/{bogus}")
        assert resp.status_code == 404