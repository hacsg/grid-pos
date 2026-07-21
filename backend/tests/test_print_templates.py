"""Tests for print template routes and renderer."""

import pytest_asyncio
from httpx import AsyncClient

from app.services.print_renderer import default_template_config, render_document, sample_order_data


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, admin_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {admin_token}"


class TestPrintTemplates:
    async def test_create_round_trip(self, client: AsyncClient, outlet) -> None:
        payload = {
            "outlet_id": str(outlet.id),
            "document_type": "receipt",
            "name": "Custom Receipt",
            "is_active": True,
            "config": default_template_config("receipt"),
        }
        created = await client.post("/api/print-templates", json=payload)
        assert created.status_code == 201
        data = created.json()
        assert data["name"] == "Custom Receipt"
        assert data["config"]["blocks"][0]["type"] == "header"

        listing = await client.get(f"/api/print-templates?outlet_id={outlet.id}&document_type=receipt")
        assert listing.status_code == 200
        rows = listing.json()
        assert len(rows) == 1
        assert rows[0]["id"] == data["id"]

    async def test_active_falls_back_to_hardcoded_default(self, client: AsyncClient, outlet) -> None:
        response = await client.get(f"/api/print-templates/active?outlet_id={outlet.id}&document_type=receipt")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Default Receipt"
        assert data["config"]["blocks"][0]["type"] == "header"

    async def test_seed_creates_both_templates(self, client: AsyncClient, outlet) -> None:
        response = await client.post("/api/print-templates/seed", json={"outlet_id": str(outlet.id)})
        assert response.status_code == 200
        rows = response.json()
        assert {row["document_type"] for row in rows} == {"receipt", "kitchen_chit"}
        assert all(row["is_active"] is True for row in rows)

    async def test_preview_returns_rendered_text(self, client: AsyncClient, outlet) -> None:
        created = await client.post(
            "/api/print-templates",
            json={
                "outlet_id": str(outlet.id),
                "document_type": "receipt",
                "name": "Preview Receipt",
                "is_active": False,
                "config": default_template_config("receipt"),
            },
        )
        template_id = created.json()["id"]
        preview = await client.post(
            f"/api/print-templates/{template_id}/preview",
            json={"order_data": sample_order_data("receipt")},
        )
        assert preview.status_code == 200
        assert "GRID WAFFLES" in preview.json()["text"]

    async def test_activating_template_deactivates_previous_template(self, client: AsyncClient, outlet) -> None:
        first = await client.post(
            "/api/print-templates",
            json={
                "outlet_id": str(outlet.id),
                "document_type": "receipt",
                "name": "First",
                "is_active": True,
                "config": default_template_config("receipt"),
            },
        )
        second = await client.post(
            "/api/print-templates",
            json={
                "outlet_id": str(outlet.id),
                "document_type": "receipt",
                "name": "Second",
                "is_active": True,
                "config": default_template_config("receipt"),
            },
        )
        assert first.status_code == 201
        assert second.status_code == 201

        listing = await client.get(f"/api/print-templates?outlet_id={outlet.id}&document_type=receipt")
        active = [template for template in listing.json() if template["is_active"]]
        assert [template["name"] for template in active] == ["Second"]

    async def test_rejects_mismatched_or_invalid_printer_config(self, client: AsyncClient, outlet) -> None:
        config = default_template_config("receipt")
        config["pageSize"]["widthMM"] = 76
        response = await client.post(
            "/api/print-templates",
            json={
                "outlet_id": str(outlet.id),
                "document_type": "receipt",
                "name": "Invalid width",
                "config": config,
            },
        )
        assert response.status_code == 400
        assert "58 or 80" in response.json()["detail"]

        mismatch = await client.post(
            "/api/print-templates",
            json={
                "outlet_id": str(outlet.id),
                "document_type": "kitchen_chit",
                "name": "Wrong blocks",
                "config": default_template_config("receipt"),
            },
        )
        assert mismatch.status_code == 400

    async def test_cashier_cannot_manage_templates(
        self, client: AsyncClient, outlet, cashier_token: str
    ) -> None:
        response = await client.post(
            "/api/print-templates",
            headers={"Authorization": f"Bearer {cashier_token}"},
            json={
                "outlet_id": str(outlet.id),
                "document_type": "receipt",
                "name": "Cashier edit",
                "config": default_template_config("receipt"),
            },
        )
        assert response.status_code == 403


def test_default_receipt_render_matches_expected_sections() -> None:
    text = render_document(default_template_config("receipt"), sample_order_data("receipt"))
    assert "GRID WAFFLES" in text
    assert "Grid Pte Ltd" in text
    assert "Order 0042" in text
    assert "TOTAL" in text
    assert "Payment: Split" in text


def test_default_kitchen_render_matches_expected_sections() -> None:
    text = render_document(default_template_config("kitchen_chit"), sample_order_data("kitchen_chit"))
    assert "#0042" in text
    assert "KITCHEN" in text
    assert "2 x COCONUT PANDAN WAFFLE" in text


def test_custom_receipt_controls_change_rendered_output() -> None:
    config = default_template_config("receipt")
    config["blocks"] = [
        {"type": "itemsTable", "visible": True, "fields": {"columns": ["name"], "showModifiers": False}},
        {"type": "totals", "visible": True, "fields": {"showDiscounts": False, "showVouchers": False, "showGrandTotal": False}},
        {"type": "text", "visible": True, "fields": {"content": "Collection copy", "align": "center", "uppercase": True}},
    ]
    text = render_document(config, sample_order_data("receipt"))
    assert "Coconut Pandan Waffle" in text
    assert "2 x Coconut" not in text
    assert "$19.98" not in text
    assert "TOTAL" not in text
    assert "Vouchers redeemed" not in text
    assert "COLLECTION COPY" in text
