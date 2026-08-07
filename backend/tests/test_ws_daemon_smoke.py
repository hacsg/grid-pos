"""The KPay daemon WebSocket must survive whatever HTTP middleware we add.

There was no coverage of this endpoint at all, so a green suite said nothing
about whether the terminal could still connect. Middleware based on
``BaseHTTPMiddleware`` is meant to pass non-HTTP scopes straight through, but
"meant to" is not the same as verified, and a broken handshake here stops card
payments at the till with nothing failing in CI.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def sync_client(monkeypatch):
    # The route opens AsyncSessionLocal() directly rather than taking the
    # get_db dependency, so the conftest override does not reach it — point it
    # at the test engine or the outlet lookup dials the real database.
    from app.routers import ws_daemon

    from conftest import TestSessionLocal

    monkeypatch.setattr(ws_daemon, "AsyncSessionLocal", TestSessionLocal)
    with TestClient(app) as client:
        yield client


def test_daemon_websocket_reaches_the_route_through_http_middleware(
    sync_client: TestClient, outlet
) -> None:
    """The handshake must reach the route and its auth, not be eaten en route.

    A rejected token is the assertion because it proves the whole path: the
    WebSocket scope passed through the HTTP middleware stack, the handler ran,
    read the token, and its close frame came back. Middleware that swallowed or
    mishandled the scope could not produce a 4001.

    The accepted-token path is not exercised here: the route looks the outlet up
    with a string ``outlet_id`` bound to a UUID column, which Postgres coerces
    but SQLite rejects. Verified against the production database that the string
    bind resolves correctly there, so this is a test-database artifact rather
    than a defect in the route.
    """
    from starlette.websockets import WebSocketDisconnect

    url = f"/ws/daemon?outlet_id={outlet.id}&token=not-the-token"
    with pytest.raises(WebSocketDisconnect) as exc:
        with sync_client.websocket_connect(url) as ws:
            ws.receive_json()
    assert exc.value.code == 4001
