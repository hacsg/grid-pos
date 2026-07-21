"""Print template SQLAlchemy model."""

from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class PrintTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Configurable receipt or kitchen chit template."""

    __tablename__ = "print_templates"
    __table_args__ = (
        UniqueConstraint("outlet_id", "document_type", "name", name="uq_print_templates_scope_name"),
    )

    outlet_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("outlets.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    document_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
