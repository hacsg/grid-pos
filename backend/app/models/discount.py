"""Discount SQLAlchemy model."""
from uuid import UUID

from sqlalchemy import Boolean, Column, ForeignKey, Integer, Numeric, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin

# Link tables for product-targeted rules: a discount points at any mix of
# categories and/or specific products.
discount_categories = Table(
    "discount_categories",
    Base.metadata,
    Column("discount_id", Uuid, ForeignKey("discounts.id", ondelete="CASCADE"), primary_key=True),
    Column("category_id", Uuid, ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True),
)

discount_products = Table(
    "discount_products",
    Base.metadata,
    Column("discount_id", Uuid, ForeignKey("discounts.id", ondelete="CASCADE"), primary_key=True),
    Column("product_id", Uuid, ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
)


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

    # Targeting: "cart" (whole cart, current) or "targeted" (only qualifying lines).
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default="cart")
    # Minimum quantity of qualifying units before a targeted rule applies.
    min_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # "gate"   -> N+ qualifying units => all qualifying units discounted.
    # "bundle" -> every complete group of N is discounted, remainder full price.
    threshold_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="gate")

    target_categories = relationship("Category", secondary=discount_categories)
    target_products = relationship("Product", secondary=discount_products)

    @property
    def target_category_ids(self) -> list[UUID]:
        return [category.id for category in self.target_categories]

    @property
    def target_product_ids(self) -> list[UUID]:
        return [product.id for product in self.target_products]
