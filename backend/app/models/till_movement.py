"""Cash movement on a till session — cash in/out and no-sale drawer opens."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin


class TillMovement(UUIDPrimaryKeyMixin, Base):
    """A cash-in (float top-up), cash-out (paid-out/drop) or no-sale drawer open.
    In/out adjust the expected drawer cash at close; all are manager-authorized."""

    __tablename__ = "till_movements"

    till_session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("till_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    direction: Mapped[str] = mapped_column(Text, nullable=False)  # in | out | nosale
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    staff_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("staff.id", ondelete="SET NULL"), nullable=True
    )
    authorized_by_staff_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("staff.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
