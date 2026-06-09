"""Campaign SQLAlchemy model."""

from datetime import date

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin


class Campaign(UUIDPrimaryKeyMixin, Base):
    """Marketing campaign used for signup attribution and vouchers."""

    __tablename__ = "campaigns"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    channel: Mapped[str | None] = mapped_column(String(80), nullable=True)
    code_prefix: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    budget_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    discount_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    start_date: Mapped[date | None] = mapped_column(nullable=True)
    end_date: Mapped[date | None] = mapped_column(nullable=True)
    auto_issue_on_signup: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    signup_voucher_discount_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    voucher_style: Mapped[str | None] = mapped_column(String, nullable=True)
    voucher_accent_color: Mapped[str | None] = mapped_column(String, nullable=True)
    voucher_headline: Mapped[str | None] = mapped_column(String, nullable=True)
    voucher_background_url: Mapped[str | None] = mapped_column(String, nullable=True)

    customers = relationship("Customer", back_populates="signup_campaign")
    vouchers = relationship("Voucher", back_populates="campaign")
