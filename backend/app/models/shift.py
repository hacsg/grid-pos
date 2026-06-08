"""Shift / clock-in-out SQLAlchemy model."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin


class Shift(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """A staff member's work shift — tracks clock-in and clock-out."""

    __tablename__ = "shifts"

    staff_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("staff.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    outlet_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("outlets.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    clock_in: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    clock_out: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    orders_processed: Mapped[int | None] = mapped_column(
        Integer, nullable=True, default=0
    )
    total_sales: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True, default=Decimal("0.00")
    )

    staff = relationship("Staff", backref="shifts")
    outlet = relationship("Outlet", backref="shifts")