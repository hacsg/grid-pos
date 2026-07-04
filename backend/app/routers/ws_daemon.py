"""WebSocket server for Go daemon connections.

Protocol:
- Daemon connects to /ws/daemon?outlet_id=UUID with Authorization: Bearer SHARED_TOKEN
- Server validates token against KPAY_DAEMON_TOKEN env var
- Server validates outlet_id exists in DB
- Daemon sends JSON commands with 'id' field for request tracking
- Server responds with matching 'id' + success/error
- Heartbeats: daemon sends {"type": "ping"} every 30s, server sends {"type": "pong"}
"""

import asyncio
import logging
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.outlet import Outlet

log = logging.getLogger(__name__)

router = APIRouter()

# Active daemon connections: outlet_id -> WebSocket
_active_connections: dict[str, WebSocket] = {}
# Pending responses: (outlet_id, request_id) -> Future[dict]
_pending_responses: dict[tuple[str, str], asyncio.Future] = {}


# Event types from the daemon that complete a request. Intermediate events
# (e.g. "sale_started") are informational and must NOT resolve the request.
_TERMINAL_EVENT_TYPES = frozenset(
    {"sale_result", "query_result", "cancel_result", "refund_result", "error"}
)


def get_daemon_connection(outlet_id: str | uuid.UUID) -> Optional[WebSocket]:
    """Get active daemon WebSocket for an outlet, or None if not connected."""
    # The registry is keyed by the outlet-id string from the daemon's connect
    # URL; callers may hold a UUID (e.g. PaymentIntent.outlet_id), which would
    # silently miss the dict lookup.
    return _active_connections.get(str(outlet_id))


async def send_to_daemon(outlet_id: str, command: str, params: dict, timeout: float = 30.0) -> dict:
    """Send a command to the daemon and wait for its terminal event.

    The Go daemon expects a flat message: {"type": <command>, "request_id": <id>,
    ...<snake_case fields>} and replies with one or more events tagged with the
    same request_id. We resolve on the terminal event for the request.

    Args:
        outlet_id: Which outlet's daemon to send to
        command: Daemon command type (e.g. "start_sale", "query", "cancel", "refund")
        params: Flat command fields (merged into the message, snake_case)
        timeout: Seconds to wait for the terminal event

    Returns:
        The terminal event dict from the daemon (includes "type" and fields).

    Raises:
        RuntimeError: If daemon not connected or timeout
    """
    # Normalize so the _pending_responses key matches what the read loop uses
    # (it resolves futures with the connection's string outlet id).
    outlet_id = str(outlet_id)
    ws = get_daemon_connection(outlet_id)
    if not ws:
        raise RuntimeError(f"Daemon not connected for outlet {outlet_id}")

    request_id = str(uuid.uuid4())

    future = asyncio.get_running_loop().create_future()
    _pending_responses[(outlet_id, request_id)] = future

    try:
        message = {"type": command, "request_id": request_id, **params}
        await ws.send_json(message)
        log.info(f"Sent to daemon {outlet_id}: {command} (request_id={request_id})")

        response = await asyncio.wait_for(future, timeout=timeout)
        return response

    except asyncio.TimeoutError:
        log.error(f"Timeout waiting for daemon {outlet_id} response to {command}")
        raise RuntimeError(f"Daemon timeout for {command}")

    except Exception as e:
        log.error(f"Error sending to daemon {outlet_id}: {e}")
        raise

    finally:
        _pending_responses.pop((outlet_id, request_id), None)


def resolve_daemon_response(outlet_id: str, request_id: str, response: dict):
    """Resolve a pending future when the daemon sends a terminal event."""
    key = (outlet_id, request_id)
    future = _pending_responses.get(key)
    if future and not future.done():
        future.set_result(response)
        log.debug(f"Resolved daemon response for {key}: {response.get('type')}")


@router.websocket("/ws/daemon")
async def websocket_daemon(websocket: WebSocket, outlet_id: str, token: str | None = None):
    """WebSocket endpoint for Go daemon connections.
    
    Validates token and outlet_id on connect, then enters message loop.
    Tracks connection state and routes responses to pending requests.
    """
    authorization = websocket.headers.get("authorization", "")
    scheme, _, credential = authorization.partition(" ")
    header_token = credential.strip() if scheme.lower() == "bearer" else ""
    # FIXME: query-string daemon auth is deprecated; remove after deployed
    # terminals have upgraded to the Authorization header handshake.
    daemon_token = header_token or token or ""

    # Validate token
    if not secrets.compare_digest(daemon_token, settings.kpay_daemon_token):
        log.warning(f"Daemon connection rejected: invalid token for outlet {outlet_id}")
        await websocket.close(code=4001, reason="Invalid token")
        return
    
    # Validate outlet exists
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Outlet).where(Outlet.id == outlet_id))
        outlet = result.scalar_one_or_none()
    
    if not outlet:
        log.warning(f"Daemon connection rejected: outlet {outlet_id} not found")
        await websocket.close(code=4002, reason="Outlet not found")
        return
    
    # Accept connection
    await websocket.accept()
    
    # Register active connection
    _active_connections[outlet_id] = websocket
    log.info(f"Daemon connected: outlet {outlet_id}")
    
    try:
        # Message loop
        while True:
            message = await websocket.receive_json()
            
            msg_type = message.get("type")

            # Handle heartbeats
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # The daemon tags every reply with the originating request_id and emits
            # one or more events. Only terminal events resolve the pending request;
            # intermediate events (e.g. "sale_started") are logged and ignored.
            request_id = message.get("request_id")
            if request_id:
                if msg_type in _TERMINAL_EVENT_TYPES:
                    resolve_daemon_response(outlet_id, request_id, message)
                else:
                    log.debug(f"Daemon {outlet_id} interim event {msg_type} (request_id={request_id})")
    
    except WebSocketDisconnect:
        log.info(f"Daemon disconnected: outlet {outlet_id}")
    
    except Exception as e:
        log.error(f"Error in daemon WebSocket {outlet_id}: {e}", exc_info=True)
    
    finally:
        # Unregister connection
        _active_connections.pop(outlet_id, None)
        
        # Cancel all pending requests for this outlet
        for (oid, _), future in list(_pending_responses.items()):
            if oid == outlet_id and not future.done():
                future.set_exception(RuntimeError("Daemon disconnected"))
        
        log.info(f"Daemon cleanup complete: outlet {outlet_id}")


# Expose connection count for monitoring
def get_active_connection_count() -> int:
    """Return number of active daemon connections."""
    return len(_active_connections)
