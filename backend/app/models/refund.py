"""Refund audit trail SQLAlchemy model."""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin


class Refund(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Recorded refund or void against a paid order."""

    __tablename__ = "refunds"
    __table_args__ = (Index("idx_refunds_order_id", "order_id"),)

    order_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("orders.id", ondelete="RESTRICT"),
        nullable=False,
    )
    staff_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("staff.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)

    order = relationship("Order", back_populates="refunds")
    staff = relationship("Staff")