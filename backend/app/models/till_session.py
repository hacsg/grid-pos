"""Cash-drawer till session — one per outlet per SGT business day."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin


class TillSession(UUIDPrimaryKeyMixin, Base):
    """Opening float at start of day; blind drawer count at close; a manager
    reviews the variance. One open session per outlet at a time (partial unique
    index uq_till_open_per_outlet)."""

    __tablename__ = "till_sessions"

    outlet_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("outlets.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")
    opening_float: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    # Carry-over from the previous close: what the drawer should hold at open
    # (previous counted cash), and declared float − that expectation.
    expected_opening_float: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    opening_variance: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    opened_by_staff_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("staff.id", ondelete="SET NULL"), nullable=True
    )
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    counted_cash: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    expected_cash: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    variance: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    closed_by_staff_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("staff.id", ondelete="SET NULL"), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
