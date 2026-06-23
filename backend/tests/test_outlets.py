"""Tests for outlet management API endpoints."""

from httpx import AsyncClient


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
