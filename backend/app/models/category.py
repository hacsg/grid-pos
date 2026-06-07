"""Category SQLAlchemy model."""

from uuid import UUID

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Category(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Product category scoped to an outlet or shared globally."""

    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    outlet_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("outlets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    outlet = relationship("Outlet", back_populates="categories")
    products = relationship("Product", back_populates="category")

