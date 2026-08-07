"""Tests for the Idempotency-Key claim lifecycle.

The claim is committed before the work runs, so the error path is what keeps a
key usable: if ``release`` cannot delete a claim, the caller's retry is met with
a 409 that masks whatever actually failed.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.idempotency_key import IdempotencyKey
from app.services import idempotency

pytestmark = pytest.mark.asyncio

SCOPE = "test.scope"
KEY = "key-1"
HASH = idempotency.fingerprint({"amount": 20})


async def _poison(db: AsyncSession) -> None:
    """Leave the session in the state a failed request hands to ``release``.

    Any error inside the request puts the session in "needs rollback": every
    later operation raises ``PendingRollbackError`` until someone rolls back.
    A duplicate-key flush gets there the same way production did (a SELECT
    against a column the deploy had not migrated in) but without depending on
    Postgres — SQLite does not abort a transaction on a failed statement.
    """
    db.add(IdempotencyKey(scope=SCOPE, idem_key=KEY, request_hash=HASH, state="in_progress"))
    with pytest.raises(Exception):
        await db.flush()
    assert not db.is_active, "session should need a rollback"


async def _claim_count(db: AsyncSession) -> int:
    result = await db.execute(select(IdempotencyKey).where(IdempotencyKey.idem_key == KEY))
    return len(result.scalars().all())


async def test_release_after_failed_request_deletes_the_claim(db_session: AsyncSession) -> None:
    """A claim is released even when the request died on a database error.

    Regression: ``release`` used to raise ``PendingRollbackError`` on this path
    and leave the claim ``in_progress``. Production hit it when a deploy
    referenced an unmigrated column — every checkout leaked a claim, and the
    cashier's retry got a 409 that hid the real error.
    """
    assert await idempotency.begin(db_session, SCOPE, KEY, HASH) is None
    await _poison(db_session)

    await idempotency.release(db_session, SCOPE, KEY)

    assert await _claim_count(db_session) == 0


async def test_key_is_reusable_after_a_failed_request(db_session: AsyncSession) -> None:
    """The same key retries cleanly once released — no 409 on the second attempt."""
    assert await idempotency.begin(db_session, SCOPE, KEY, HASH) is None
    await _poison(db_session)
    await idempotency.release(db_session, SCOPE, KEY)

    assert await idempotency.begin(db_session, SCOPE, KEY, HASH) is None


async def test_release_does_not_drop_a_completed_claim(db_session: AsyncSession) -> None:
    """A stored response survives release, so duplicates still replay it."""
    await idempotency.begin(db_session, SCOPE, KEY, HASH)
    await idempotency.complete(db_session, SCOPE, KEY, 201, {"id": "abc"})

    await idempotency.release(db_session, SCOPE, KEY)

    replay = await idempotency.begin(db_session, SCOPE, KEY, HASH)
    assert replay is not None
    assert replay.status_code == 201
    assert replay.body == {"id": "abc"}


async def test_duplicate_in_flight_is_rejected(db_session: AsyncSession) -> None:
    """A live claim still blocks a concurrent duplicate — the guard itself holds."""
    assert await idempotency.begin(db_session, SCOPE, KEY, HASH) is None

    with pytest.raises(HTTPException) as exc:
        await idempotency.begin(db_session, SCOPE, KEY, HASH)
    assert exc.value.status_code == 409
