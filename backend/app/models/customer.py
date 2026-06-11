"""Customer SQLAlchemy model."""

from uuid import UUID

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin


class Customer(UUIDPrimaryKeyMixin, Base):
    """Acre Club / Plotholders customer account."""

    __tablename__ = "customers"

    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tier: Mapped[str] = mapped_column(String(20), nullable=False, default="bronze")
    moments_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    signup_campaign_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("campaigns.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    signup_campaign = relationship("Campaign", back_populates="customers")
    vouchers = relationship("Voucher", back_populates="customer")
