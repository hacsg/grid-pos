"""WebSocket server for Go daemon connections.

Protocol:
- Daemon connects to /ws/daemon?token=SHARED_TOKEN&outlet_id=UUID
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


def get_daemon_connection(outlet_id: str) -> Optional[WebSocket]:
    """Get active daemon WebSocket for an outlet, or None if not connected."""
    return _active_connections.get(outlet_id)


async def send_to_daemon(outlet_id: str, command: str, params: dict, timeout: float = 30.0) -> dict:
    """Send command to daemon and wait for response.
    
    Args:
        outlet_id: Which outlet's daemon to send to
        command: Command name (e.g., "start_sale", "query")
        params: Command parameters
        timeout: Seconds to wait for response (default 30s)
    
    Returns:
        Daemon response dict with 'success' and 'result'/'error' fields
    
    Raises:
        RuntimeError: If daemon not connected or timeout
    """
    ws = get_daemon_connection(outlet_id)
    if not ws:
        raise RuntimeError(f"Daemon not connected for outlet {outlet_id}")
    
    # Generate unique request ID
    request_id = str(uuid.uuid4())
    
    # Create future for response
    future = asyncio.get_running_loop().create_future()
    _pending_responses[(outlet_id, request_id)] = future
    
    try:
        # Send command
        message = {"id": request_id, "command": command, "params": params}
        await ws.send_json(message)
        log.info(f"Sent to daemon {outlet_id}: {command} (id={request_id})")
        
        # Wait for response with timeout
        response = await asyncio.wait_for(future, timeout=timeout)
        return response
    
    except asyncio.TimeoutError:
        log.error(f"Timeout waiting for daemon {outlet_id} response to {command}")
        raise RuntimeError(f"Daemon timeout for {command}")
    
    except Exception as e:
        log.error(f"Error sending to daemon {outlet_id}: {e}")
        raise
    
    finally:
        # Clean up pending response
        _pending_responses.pop((outlet_id, request_id), None)


def resolve_daemon_response(outlet_id: str, request_id: str, response: dict):
    """Resolve a pending response future when daemon replies."""
    key = (outlet_id, request_id)
    future = _pending_responses.get(key)
    if future and not future.done():
        future.set_result(response)
        log.debug(f"Resolved daemon response for {key}")


@router.websocket("/ws/daemon")
async def websocket_daemon(websocket: WebSocket, token: str, outlet_id: str):
    """WebSocket endpoint for Go daemon connections.
    
    Validates token and outlet_id on connect, then enters message loop.
    Tracks connection state and routes responses to pending requests.
    """
    # Validate token
    if not secrets.compare_digest(token, settings.kpay_daemon_token):
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
            
            # Handle heartbeats
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            
            # Handle daemon responses to our commands
            if "id" in message:
                request_id = message["id"]
                resolve_daemon_response(outlet_id, request_id, message)
            
            # Note: daemon may also send unsolicited messages (e.g., async status updates)
            # Future: handle those here if needed
    
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
