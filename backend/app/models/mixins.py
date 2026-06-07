"""Reusable SQLAlchemy model mixins."""

from datetime import datetime
from uuid import UUID
from uuid import uuid4

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid


class UUIDPrimaryKeyMixin:
    """Provide a UUID primary key column."""

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)


class CreatedAtMixin:
    """Provide a creation timestamp column."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class TimestampMixin(CreatedAtMixin):
    """Provide creation and update timestamp columns."""

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
