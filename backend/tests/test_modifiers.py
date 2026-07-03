"""Tests for the new standalone modifier groups + options + product assignments."""

import pytest
import pytest_asyncio
from httpx import AsyncClient


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, cashier_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {cashier_token}"


# =========================================================================
# Modifier Groups (standalone)
# =========================================================================


class TestListModifierGroups:
    """GET /api/modifier-groups"""

    async def test_empty(self, client: AsyncClient) -> None:
        resp = await client.get("/api/modifier-groups")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_groups_with_options(self, client: AsyncClient, modifier_group, modifier_option) -> None:
        resp = await client.get("/api/modifier-groups")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Size"
        assert len(data[0]["options"]) == 1
        assert data[0]["options"][0]["name"] == "Large"


class TestCreateModifierGroup:
    """POST /api/modifier-groups"""

    async def test_valid(self, client: AsyncClient) -> None:
        payload = {"name": "Toppings", "description": "Extra add-ons"}
        resp = await client.post("/api/modifier-groups", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Toppings"
        assert data["description"] == "Extra add-ons"
        assert "id" in data

    async def test_minimal(self, client: AsyncClient) -> None:
        resp = await client.post("/api/modifier-groups", json={"name": "Milk"})
        assert resp.status_code == 201
        assert resp.json()["description"] is None


class TestUpdateModifierGroup:
    """PUT /api/modifier-groups/{id}"""

    async def test_update_name_and_description(self, client: AsyncClient, modifier_group) -> None:
        resp = await client.put(
            f"/api/modifier-groups/{modifier_group.id}",
            json={"name": "Cup Size", "description": "Select cup"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Cup Size"
        assert data["description"] == "Select cup"

    async def test_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.put(f"/api/modifier-groups/{bogus}", json={"name": "X"})
        assert resp.status_code == 404


class TestDeleteModifierGroup:
    """DELETE /api/modifier-groups/{id}"""

    async def test_delete_cascades_options(self, client: AsyncClient, modifier_group, modifier_option) -> None:
        resp = await client.delete(f"/api/modifier-groups/{modifier_group.id}")
        assert resp.status_code == 204

        # group gone
        resp2 = await client.delete(f"/api/modifier-groups/{modifier_group.id}")
        assert resp2.status_code == 404

    async def test_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.delete(f"/api/modifier-groups/{bogus}")
        assert resp.status_code == 404


# =========================================================================
# Modifier Options
# =========================================================================


class TestCreateModifierOption:
    """POST /api/modifier-groups/{group_id}/options"""

    async def test_valid(self, client: AsyncClient, modifier_group) -> None:
        payload = {"name": "Medium", "price_adjustment": "1.50", "display_order": 5, "is_available": True}
        resp = await client.post(f"/api/modifier-groups/{modifier_group.id}/options", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Medium"
        assert str(data["price_adjustment"]) == "1.50"
        assert data["display_order"] == 5

    async def test_nonexistent_group_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.post(f"/api/modifier-groups/{bogus}/options", json={"name": "X"})
        assert resp.status_code == 404


class TestUpdateModifierOption:
    """PUT /api/modifier-options/{id}"""

    async def test_update_fields(self, client: AsyncClient, modifier_option) -> None:
        resp = await client.put(
            f"/api/modifier-options/{modifier_option.id}",
            json={"name": "XL", "price_adjustment": "2.00", "is_available": False},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "XL"
        assert str(data["price_adjustment"]) == "2.00"
        assert data["is_available"] is False

    async def test_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.put(f"/api/modifier-options/{bogus}", json={"name": "Ghost"})
        assert resp.status_code == 404


class TestDeleteModifierOption:
    """DELETE /api/modifier-options/{id}"""

    async def test_delete(self, client: AsyncClient, modifier_option) -> None:
        resp = await client.delete(f"/api/modifier-options/{modifier_option.id}")
        assert resp.status_code == 204
        resp2 = await client.delete(f"/api/modifier-options/{modifier_option.id}")
        assert resp2.status_code == 404

    async def test_nonexistent_returns_404(self, client: AsyncClient) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.delete(f"/api/modifier-options/{bogus}")
        assert resp.status_code == 404


# =========================================================================
# Product Modifier Group Assignments
# =========================================================================


class TestAssignModifierGroupToProduct:
    """POST /api/products/{id}/modifier-groups"""

    async def test_assign_valid(self, client: AsyncClient, product, modifier_group) -> None:
        payload = {
            "group_id": str(modifier_group.id),
            "min_select": 1,
            "max_select": 2,
            "is_required": True,
            "display_order": 10,
        }
        resp = await client.post(f"/api/products/{product.id}/modifier-groups", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["group_id"] == str(modifier_group.id)
        assert data["min_select"] == 1
        assert data["max_select"] == 2
        assert data["is_required"] is True
        assert len(data["options"]) == 0  # no options yet

    async def test_duplicate_assignment_conflict(self, client: AsyncClient, product, modifier_group) -> None:
        payload = {"group_id": str(modifier_group.id)}
        r1 = await client.post(f"/api/products/{product.id}/modifier-groups", json=payload)
        assert r1.status_code == 201
        r2 = await client.post(f"/api/products/{product.id}/modifier-groups", json=payload)
        assert r2.status_code == 409

    async def test_nonexistent_product(self, client: AsyncClient, modifier_group) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.post(f"/api/products/{bogus}/modifier-groups", json={"group_id": str(modifier_group.id)})
        assert resp.status_code == 404

    async def test_nonexistent_group(self, client: AsyncClient, product) -> None:
        bogus = "00000000-0000-0000-0000-000000000000"
        resp = await client.post(f"/api/products/{product.id}/modifier-groups", json={"group_id": bogus})
        assert resp.status_code == 404


class TestListProductModifierGroups:
    """GET /api/products/{id}/modifier-groups and via product detail"""

    async def test_list_assigned(self, client: AsyncClient, product, modifier_group, product_modifier_assignment) -> None:
        resp = await client.get(f"/api/products/{product.id}/modifier-groups")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["group_name"] == "Size"

    async def test_included_on_product_detail(self, client: AsyncClient, product, product_modifier_assignment, modifier_option) -> None:
        # add an option so we can assert nesting
        resp = await client.get(f"/api/products/{product.id}")
        assert resp.status_code == 200
        mg = resp.json()["modifier_groups"]
        assert len(mg) == 1
        assert mg[0]["group_name"] == "Size"
        assert len(mg[0]["options"]) == 1


class TestUpdateProductModifierAssignment:
    """PUT /api/products/{id}/modifier-groups/{assignment_id}"""

    async def test_update_min_max(self, client: AsyncClient, product, product_modifier_assignment) -> None:
        assignment_id = product_modifier_assignment.id
        resp = await client.put(
            f"/api/products/{product.id}/modifier-groups/{assignment_id}",
            json={"min_select": 2, "max_select": 2},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["min_select"] == 2
        assert data["max_select"] == 2

    async def test_invalid_bounds_returns_400(self, client: AsyncClient, product, product_modifier_assignment) -> None:
        assignment_id = product_modifier_assignment.id
        resp = await client.put(
            f"/api/products/{product.id}/modifier-groups/{assignment_id}",
            json={"min_select": 5, "max_select": 1},
        )
        assert resp.status_code == 400

    async def test_wrong_product_returns_404(self, client: AsyncClient, other_category, product, product_modifier_assignment) -> None:
        # create another product
        r = await client.post(
            "/api/products",
            json={"name": "OtherProd", "price": "3.00", "category_id": str(other_category.id)},
        )
        other_prod_id = r.json()["id"]
        # try to update assignment under wrong product path
        resp = await client.put(
            f"/api/products/{other_prod_id}/modifier-groups/{product_modifier_assignment.id}",
            json={"min_select": 0},
        )
        assert resp.status_code == 404


class TestUnassignModifierGroup:
    """DELETE /api/products/{id}/modifier-groups/{assignment_id}"""

    async def test_unassign(self, client: AsyncClient, product, product_modifier_assignment) -> None:
        assignment_id = product_modifier_assignment.id
        resp = await client.delete(f"/api/products/{product.id}/modifier-groups/{assignment_id}")
        assert resp.status_code == 204
        # confirm gone
        list_resp = await client.get(f"/api/products/{product.id}/modifier-groups")
        assert list_resp.status_code == 200
        assert list_resp.json() == []

    async def test_unassign_wrong_product_404(self, client: AsyncClient, other_category, product, product_modifier_assignment) -> None:
        r = await client.post(
            "/api/products",
            json={"name": "P2", "price": "1.00", "category_id": str(other_category.id)},
        )
        other_id = r.json()["id"]
        resp = await client.delete(f"/api/products/{other_id}/modifier-groups/{product_modifier_assignment.id}")
        assert resp.status_code == 404
