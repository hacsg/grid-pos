"""Outlet SQLAlchemy model."""

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Outlet(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Physical outlet where POS orders are placed."""

    __tablename__ = "outlets"

    name: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    address: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    paynow_qr_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    categories = relationship("Category", back_populates="outlet")
    staff_members = relationship("Staff", back_populates="outlet")
    orders = relationship("Order", back_populates="outlet")
