"""Generated daily GTO file record (landlord SFTP feed)."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin


class GtoFile(UUIDPrimaryKeyMixin, Base):
    """One row per SGT sales date. Retains the file content as a backup so an
    unsent file can be re-transmitted when SFTP is restored; batch_id is stable
    across regenerations of the same date (mall spec)."""

    __tablename__ = "gto_files"

    sales_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    batch_id: Mapped[int] = mapped_column(Integer, nullable=False)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    upload_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
