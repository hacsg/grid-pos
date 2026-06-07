"""Sales reporting API routes."""

from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.report import DailySalesReport
from app.services.reports import get_daily_sales_report

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/sales/daily", response_model=DailySalesReport)
async def daily_sales_report(
    report_date: date | None = None,
    outlet_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> DailySalesReport:
    """Return a daily sales report for all outlets or one outlet."""
    selected_date = report_date or datetime.now(UTC).date()
    return await get_daily_sales_report(db, selected_date, outlet_id)

