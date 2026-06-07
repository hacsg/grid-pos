"""Staff SQLAlchemy model."""

from enum import Enum
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class StaffRole(str, Enum):
    """Supported staff authorization roles."""

    cashier = "cashier"
    supervisor = "supervisor"
    manager = "manager"
    admin = "admin"


class Staff(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """POS staff member with PIN authentication."""

    __tablename__ = "staff"

    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    pin_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[StaffRole] = mapped_column(SQLEnum(StaffRole, name="staff_role"), nullable=False)
    outlet_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("outlets.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    outlet = relationship("Outlet", back_populates="staff_members")
    orders = relationship("Order", back_populates="staff")

