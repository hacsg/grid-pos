from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, UniqueConstraint, Index, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.outlet import Outlet

class HistoricalDailySale(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "historical_daily_sales"

    outlet_id: Mapped[UUID] = mapped_column(ForeignKey("outlets.id"), nullable=False)
    sales_date: Mapped[date] = mapped_column(Date, nullable=False)
    net_sales: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    transaction_count: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(255), nullable=False)

    outlet: Mapped["Outlet"] = relationship()

    __table_args__ = (
        UniqueConstraint("outlet_id", "sales_date", "source", name="uq_historical_daily_sales_outlet_date_source"),
        CheckConstraint("net_sales >= 0", name="chk_historical_daily_sales_net_nonnegative"),
        CheckConstraint("transaction_count >= 0", name="chk_historical_daily_sales_txn_nonnegative"),
        Index("ix_historical_daily_sales_outlet_date", "outlet_id", "sales_date"),
    )
