"""Tests for outlet management API endpoints."""

import pytest_asyncio
from httpx import AsyncClient


@pytest_asyncio.fixture(autouse=True)
async def _authenticated_client(client: AsyncClient, cashier_token: str) -> None:
    client.headers["Authorization"] = f"Bearer {cashier_token}"


async def test_logoutlet_public(client: AsyncClient) -> None:
    client.headers.pop("Authorization", None)

    resp = await client.get("/api/outlets")

    assert resp.status_code == 200


class TestPayNowQr:
    """Manual PayNow QR endpoints."""

    async def test_get_empty_paynow_qr(self, client: AsyncClient, outlet) -> None:
        resp = await client.get(f"/api/outlets/{outlet.id}/paynow-qr")

        assert resp.status_code == 200
        data = resp.json()
        assert data["outlet_id"] == str(outlet.id)
        assert data["paynow_qr_url"] is None

    async def test_upload_and_replace_paynow_qr(self, client: AsyncClient, outlet) -> None:
        png_bytes = b"\x89PNG\r\n\x1a\nqr-one"
        resp = await client.put(
            f"/api/outlets/{outlet.id}/paynow-qr",
            files={"file": ("paynow.png", png_bytes, "image/png")},
        )

        assert resp.status_code == 200
        first_qr = resp.json()["paynow_qr_url"]
        assert first_qr.startswith("data:image/png;base64,")

        jpg_bytes = b"\xff\xd8\xffqr-two"
        replace_resp = await client.put(
            f"/api/outlets/{outlet.id}/paynow-qr",
            files={"file": ("paynow.jpg", jpg_bytes, "image/jpeg")},
        )

        assert replace_resp.status_code == 200
        second_qr = replace_resp.json()["paynow_qr_url"]
        assert second_qr.startswith("data:image/jpeg;base64,")
        assert second_qr != first_qr

        get_resp = await client.get(f"/api/outlets/{outlet.id}/paynow-qr")
        assert get_resp.status_code == 200
        assert get_resp.json()["paynow_qr_url"] == second_qr

    async def test_upload_rejects_non_image(self, client: AsyncClient, outlet) -> None:
        resp = await client.put(
            f"/api/outlets/{outlet.id}/paynow-qr",
            files={"file": ("paynow.txt", b"not an image", "text/plain")},
        )

        assert resp.status_code == 400
        assert "PNG or JPG" in resp.json()["detail"]

    async def test_delete_paynow_qr(self, client: AsyncClient, outlet) -> None:
        await client.put(
            f"/api/outlets/{outlet.id}/paynow-qr",
            files={"file": ("paynow.png", b"\x89PNG\r\n\x1a\nqr", "image/png")},
        )

        resp = await client.delete(f"/api/outlets/{outlet.id}/paynow-qr")

        assert resp.status_code == 200
        assert resp.json()["paynow_qr_url"] is None


class TestOutletUpdate:
    """Outlet edit endpoint, including receipt and PayNow settings."""

    async def test_patch_updates_receipt_and_paynow_fields(self, client: AsyncClient, outlet) -> None:
        resp = await client.patch(
            f"/api/outlets/{outlet.id}",
            json={
                "address": "12 Sunset Way",
                "receipt_brand_name": "Hundred Acre",
                "receipt_company_details": "HAC North Pte Ltd\nUEN 202031206N",
                "paynow_uen": "202031206N",
                "manual_terminal_mode": False,
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["address"] == "12 Sunset Way"
        assert data["receipt_brand_name"] == "Hundred Acre"
        assert data["receipt_company_details"] == "HAC North Pte Ltd\nUEN 202031206N"
        assert data["paynow_uen"] == "202031206N"
        assert data["manual_terminal_mode"] is False

    async def test_create_accepts_receipt_and_paynow_fields(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/api/outlets",
            json={
                "name": "HAC Test Way",
                "address": "1 Test Road",
                "receipt_brand_name": "Hundred Acre",
                "paynow_uen": "202031206N",
            },
        )

        assert resp.status_code == 201
        data = resp.json()
        assert data["receipt_brand_name"] == "Hundred Acre"
        assert data["paynow_uen"] == "202031206N"
        assert data["manual_terminal_mode"] is True
