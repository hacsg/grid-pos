"""Order item SQLAlchemy model."""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import ForeignKey, Integer, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin


class OrderItem(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Line item captured on an order."""

    __tablename__ = "order_items"

    order_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    product_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    modifiers: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list)
    selected_modifiers: Mapped[list[dict]] = mapped_column(JSON, nullable=True, default=list)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)

    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")

