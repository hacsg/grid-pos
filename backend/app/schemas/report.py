"""Reporting response schemas for the admin dashboard."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import Money


class HourlySales(BaseModel):
    """Sales aggregated for a single hour of the day."""

    hour: int = Field(..., ge=0, le=23)
    revenue: Money = Decimal("0.00")
    transactions: int = 0


class PaymentBreakdown(BaseModel):
    """Payment method -> total revenue mapping."""

    data: dict[str, Money] = Field(default_factory=dict, alias="__root__")

    def __getitem__(self, key: str) -> Money:
        return self.data[key]

    def __setitem__(self, key: str, value: Money) -> None:
        self.data[key] = value

    def dict(self, *args, **kwargs) -> dict[str, Money]:
        return dict(self.data)


class CategoryBreakdown(BaseModel):
    """Revenue breakdown by product category."""

    category: str
    revenue: Money = Decimal("0.00")
    percentage: float = 0.0


class ProductPerformance(BaseModel):
    """Single product's performance metrics."""

    product_id: UUID
    name: str
    units_sold: int = 0
    revenue: Money = Decimal("0.00")
    avg_modifiers: float = 0.0


class StaffPerformance(BaseModel):
    """Single staff member's performance metrics."""

    staff_id: UUID
    name: str
    transactions: int = 0
    revenue: Money = Decimal("0.00")
    average_ticket: Money = Decimal("0.00")


class OutletComparison(BaseModel):
    """Single outlet's comparison metrics."""

    outlet_id: UUID
    name: str
    revenue: Money = Decimal("0.00")
    transactions: int = 0
    average_ticket: Money = Decimal("0.00")
    top_product: str = ""


# ---- Period-level responses ----


class _PeriodSalesMixin(BaseModel):
    """Shared fields for daily/weekly/monthly responses."""

    total_revenue: Money = Decimal("0.00")
    total_transactions: int = 0
    average_ticket: Money = Decimal("0.00")
    change_percent: float = 0.0
    payment_breakdown: dict[str, Money] = Field(default_factory=dict)
    hourly_sales: list[HourlySales] = Field(default_factory=list)


class DailyReportResponse(_PeriodSalesMixin):
    """Daily sales report matching admin frontend expectations."""

    date: date


class WeeklyReportResponse(_PeriodSalesMixin):
    """Weekly sales report for an ISO week."""

    week: str  # e.g. "2026-W23"


class MonthlyReportResponse(_PeriodSalesMixin):
    """Monthly sales report."""

    month: str  # e.g. "2026-06"


# ---- Entity reports ----


class ProductReportResponse(BaseModel):
    """Product performance report."""

    products: list[ProductPerformance] = Field(default_factory=list)
    category_breakdown: list[CategoryBreakdown] = Field(default_factory=list)


class StaffReportResponse(BaseModel):
    """Staff performance report."""

    staff: list[StaffPerformance] = Field(default_factory=list)


class OutletReportResponse(BaseModel):
    """Outlet comparison report."""

    outlets: list[OutletComparison] = Field(default_factory=list)