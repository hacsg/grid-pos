"""Outlet SQLAlchemy model."""

from sqlalchemy import Boolean, String, Text
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
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_brand_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_company_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    paynow_uen: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When true (default), the POS does NOT drive the KPay terminal: staff key
    # card amounts into the terminal manually and PayNow uses the self-QR.
    manual_terminal_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    categories = relationship("Category", back_populates="outlet")
    staff_members = relationship("Staff", back_populates="outlet")
    orders = relationship("Order", back_populates="outlet")
