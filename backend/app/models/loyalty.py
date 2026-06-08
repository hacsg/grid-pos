"""Loyalty member SQLAlchemy model."""

from decimal import Decimal

from sqlalchemy import Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class LoyaltyTier(str):
    """Supported loyalty tiers."""

    bronze = "bronze"
    silver = "silver"
    gold = "gold"
    platinum = "platinum"


class LoyaltyMember(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Loyalty program member."""

    __tablename__ = "loyalty_members"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    country_code: Mapped[str] = mapped_column(String(5), nullable=False, default="+65")
    points: Mapped[int] = mapped_column(nullable=False, default=0)
    tier: Mapped[str] = mapped_column(String(20), nullable=False, default="bronze")
    total_spent: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)