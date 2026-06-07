"""Reporting response schemas."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.common import Money


class DailySalesReport(BaseModel):
    """Daily sales summary response payload."""

    report_date: date
    outlet_id: UUID | None
    paid_orders: int
    refunded_orders: int
    cancelled_orders: int
    gross_sales: Money = Decimal("0.00")
    refunds: Money = Decimal("0.00")
    net_sales: Money = Decimal("0.00")

