"""Modifier group, option, and product assignment SQLAlchemy models."""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin


class ModifierGroup(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A reusable group of modifier options (e.g. Flavors, Cone/Cup)."""

    __tablename__ = "modifier_groups"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    options = relationship(
        "ModifierOption",
        back_populates="modifier_group",
        cascade="all, delete-orphan",
        order_by="ModifierOption.display_order",
    )
    product_assignments = relationship(
        "ProductModifierGroup",
        back_populates="group",
        cascade="all, delete-orphan",
    )


class ModifierOption(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """A single option within a modifier group."""

    __tablename__ = "modifier_options"

    group_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("modifier_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    price_adjustment: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
        default=0,
        server_default="0",
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_available: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    modifier_group = relationship("ModifierGroup", back_populates="options")


class ProductModifierGroup(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Junction assigning a modifier group to a product with selection rules."""

    __tablename__ = "product_modifier_groups"
    __table_args__ = (
        UniqueConstraint("product_id", "group_id", name="uq_product_modifier_group"),
    )

    product_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    group_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("modifier_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    min_select: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    max_select: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    is_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    product = relationship("Product", back_populates="modifier_group_assignments")
    group = relationship("ModifierGroup", back_populates="product_assignments")
