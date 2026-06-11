"""Discount SQLAlchemy model."""
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Discount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "discounts"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="percent")  # "percent" or "fixed"
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    outlet_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("outlets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # sort_order for display ordering in POS picker
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
