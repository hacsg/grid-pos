"""Product SQLAlchemy model."""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Product(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Sellable menu item or retail product."""

    __tablename__ = "products"

    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    category_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    category = relationship("Category", back_populates="products")
    modifier_groups = relationship(
        "ModifierGroup",
        back_populates="product",
        cascade="all, delete-orphan",
    )
    order_items = relationship("OrderItem", back_populates="product")

