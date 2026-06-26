"""Database-level idempotency for payment endpoints.

A client supplies an ``Idempotency-Key`` header. The first request for a given
``(scope, key)`` claims a row, does the work, and stores its response; any
duplicate replays that stored response instead of repeating the side effect
(a second order, a second card charge). Concurrent duplicates collide on the
``(scope, idem_key)`` primary key, so exactly one wins — the guard is atomic at
the database level, not a read-then-write check two requests could both pass.

Lifecycle, from the caller's perspective::

    replay = await idempotency.begin(session, scope, key, fingerprint(body))
    if replay is not None:
        return JSONResponse(replay.body, status_code=replay.status_code)
    try:
        ...do the work...
        await idempotency.complete(session, scope, key, status_code, body)
    except Exception:
        await idempotency.release(session, scope, key)  # let a failed call retry
        raise
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.idempotency_key import IdempotencyKey

log = logging.getLogger(__name__)

# An ``in_progress`` claim older than this is treated as abandoned (the owner
# crashed mid-request) and may be reclaimed. Must exceed the longest synchronous
# payment so we never steal a key from a sale that is still running: the KPay
# sale timeout is 80s, so 180s leaves comfortable headroom.
STALE_CLAIM_SECONDS = 180


@dataclass
class Replay:
    """A previously stored response to return for a duplicate request."""

    status_code: int
    body: Any


def fingerprint(payload: Any) -> str:
    """Stable hash of a request body, used to detect a key reused with a different body."""
    encoded = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _as_aware(value: datetime) -> datetime:
    """Treat naive timestamps (SQLite) as UTC so arithmetic is well defined."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


async def begin(
    session: AsyncSession, scope: str, key: str, request_hash: str
) -> Optional[Replay]:
    """Claim ``(scope, key)`` for this request.

    Returns ``None`` if this request now owns the key and should do the work.
    Returns a :class:`Replay` if a completed response is already stored.
    Raises 409 if another request holds a fresh in-progress claim (duplicate in
    flight), or 422 if the key was previously used with a different request body.
    """
    now = datetime.now(timezone.utc)
    claim = IdempotencyKey(
        scope=scope,
        idem_key=key,
        request_hash=request_hash,
        state="in_progress",
        created_at=now,
        updated_at=now,
    )
    session.add(claim)
    try:
        await session.flush()
        await session.commit()
        return None  # We inserted the row, so we own the key.
    except IntegrityError:
        # Someone else already claimed it — fall through to inspect their row.
        await session.rollback()

    existing = await session.get(IdempotencyKey, (scope, key))
    if existing is None:
        # The conflicting row disappeared between our flush and read (it was
        # released). Safe to treat this request as the owner.
        return None

    if existing.request_hash != request_hash:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Idempotency-Key reused with a different request body",
        )

    if existing.state == "completed":
        log.info("Idempotency replay scope=%s key=%s", scope, key)
        return Replay(status_code=existing.response_status or 200, body=existing.response_body)

    # state == "in_progress": a duplicate is racing us, or the original owner died.
    if now - _as_aware(existing.created_at) > timedelta(seconds=STALE_CLAIM_SECONDS):
        existing.state = "in_progress"
        existing.request_hash = request_hash
        existing.created_at = now
        existing.updated_at = now
        await session.commit()
        log.warning("Reclaimed stale idempotency claim scope=%s key=%s", scope, key)
        return None

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="A request with this Idempotency-Key is already in progress",
    )


async def complete(
    session: AsyncSession, scope: str, key: str, status_code: int, body: Any
) -> None:
    """Store the response for a claimed key so duplicates can replay it."""
    record = await session.get(IdempotencyKey, (scope, key))
    if record is None:
        return
    record.state = "completed"
    record.response_status = status_code
    record.response_body = body
    record.updated_at = datetime.now(timezone.utc)
    await session.commit()


async def release(session: AsyncSession, scope: str, key: str) -> None:
    """Drop an in-progress claim so a failed request can be retried immediately."""
    record = await session.get(IdempotencyKey, (scope, key))
    if record is not None and record.state != "completed":
        await session.delete(record)
        await session.commit()
