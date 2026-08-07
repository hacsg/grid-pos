"""Product SQLAlchemy model."""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Product(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Sellable menu item or retail product."""

    __tablename__ = "products"

    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    category_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # Open-price: the order line supplies the amount (ad-hoc upcharges).
    is_open_price: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Selling this rings up a physical gift card: the POS must scan a card and
    # activate it for the product's price before the sale can complete.
    is_gift_card: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    category = relationship("Category", back_populates="products")
    modifier_group_assignments = relationship(
        "ProductModifierGroup",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductModifierGroup.display_order",
    )
    order_items = relationship("OrderItem", back_populates="product")

