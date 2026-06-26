"""Idempotency key model for deduplicating payment requests.

One row per (scope, Idempotency-Key). The first request claims the row in the
``in_progress`` state; once it finishes it stores its response and flips to
``completed`` so duplicates can replay it. The composite primary key makes the
claim atomic — concurrent duplicates collide and exactly one proceeds.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    scope: Mapped[str] = mapped_column(String(80), primary_key=True)
    idem_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    # Hash of the request body; a reused key with a different body is a client bug.
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # "in_progress" while the first request runs, "completed" once stored.
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")
    response_status: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # JSON (not JSONB) so the same model builds on SQLite in tests; the SQL
    # migration uses JSONB for Postgres.
    response_body: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
