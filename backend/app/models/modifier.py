"""Modifier group and modifier SQLAlchemy models."""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class ModifierGroup(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A selectable group of modifiers for one product."""

    __tablename__ = "modifier_groups"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    min_select: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    max_select: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    product_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    product = relationship("Product", back_populates="modifier_groups")
    modifiers = relationship("Modifier", back_populates="modifier_group", cascade="all, delete-orphan")


class Modifier(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A single selectable product modifier."""

    __tablename__ = "modifiers"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    price_adjustment: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
        default=0,
        server_default="0",
    )
    modifier_group_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("modifier_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    modifier_group = relationship("ModifierGroup", back_populates="modifiers")

