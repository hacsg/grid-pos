"""Unhandled 500s must leave the server with CORS headers and a safe body.

Without a handler inside CORSMiddleware, Starlette's outermost ServerErrorMiddleware
returns a bare 500. Browsers strip it; axios reports "Network Error"; cashiers retry
and duplicate orders. These tests pin the fix.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

SECRET_EXCEPTION_MESSAGE = "super-secret-internal-detail-xyz"
BOOM_PATH = "/__test__/unhandled-boom"
HTTP_EXC_PATH = "/__test__/http-exc-404"
ALLOWED_ORIGIN = settings.cors_origins[0]


def _register_test_routes() -> None:
    """Install one-shot routes used only by this module's tests."""

    async def boom() -> None:
        raise RuntimeError(SECRET_EXCEPTION_MESSAGE)

    async def not_found() -> None:
        raise HTTPException(status_code=404, detail="Item not found")

    # Avoid stacking duplicates if the module is re-imported.
    existing = {getattr(route, "path", None) for route in app.router.routes}
    if BOOM_PATH not in existing:
        app.add_api_route(BOOM_PATH, boom, methods=["GET"], include_in_schema=False)
    if HTTP_EXC_PATH not in existing:
        app.add_api_route(HTTP_EXC_PATH, not_found, methods=["GET"], include_in_schema=False)


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Sync TestClient with server exceptions turned into responses."""
    _register_test_routes()
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def test_unhandled_exception_returns_500_with_cors_headers(client: TestClient) -> None:
    """A route that raises must return 500 *and* access-control-allow-origin.

    Regression: middleware registered outside CORS looks identical for status
    and body but leaves the header None — exactly the production bug.
    """
    resp = client.get(BOOM_PATH, headers={"Origin": ALLOWED_ORIGIN})

    assert resp.status_code == 500
    assert resp.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN


def test_unhandled_exception_body_has_safe_detail(client: TestClient) -> None:
    """Body carries a detail string and never the original exception message."""
    resp = client.get(BOOM_PATH, headers={"Origin": ALLOWED_ORIGIN})

    assert resp.status_code == 500
    body = resp.json()
    assert "detail" in body
    assert isinstance(body["detail"], str)
    assert SECRET_EXCEPTION_MESSAGE not in body["detail"]
    assert "Ref:" in body["detail"]
    assert "Don't retry" in body["detail"]


def test_http_exception_unchanged(client: TestClient) -> None:
    """Handled HTTPException keeps its status and body; only unhandled become 500."""
    resp = client.get(HTTP_EXC_PATH, headers={"Origin": ALLOWED_ORIGIN})

    assert resp.status_code == 404
    assert resp.json() == {"detail": "Item not found"}
