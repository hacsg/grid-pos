"""Sales reporting API routes – endpoints the admin frontend expects."""

from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.report import (
    DailyReportResponse,
    MonthlyReportResponse,
    OutletReportResponse,
    ProductReportResponse,
    SalesSummaryResponse,
    StaffReportResponse,
    WeeklyReportResponse,
)
from app.services.reports import (
    get_daily_report,
    get_monthly_report,
    get_outlet_report,
    get_product_report,
    get_sales_summary,
    get_staff_report,
    get_weekly_report,
)

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/sales-summary", response_model=SalesSummaryResponse)
async def sales_summary(db: AsyncSession = Depends(get_db)) -> SalesSummaryResponse:
    """Return today's total sales, order count, and average order value."""
    today = datetime.now(UTC).date()
    return await get_sales_summary(db, today)


@router.get("/daily", response_model=DailyReportResponse)
async def daily_report(
    date: date | None = Query(None, description="Report date (default: today)"),
    outlet_id: UUID | None = Query(None, description="Filter by outlet"),
    db: AsyncSession = Depends(get_db),
) -> DailyReportResponse:
    """Return daily sales report with hourly breakdown and change vs last week."""
    report_date = date or datetime.now(UTC).date()
    return await get_daily_report(db, report_date, outlet_id)


@router.get("/weekly", response_model=WeeklyReportResponse)
async def weekly_report(
    week: str | None = Query(
        None, description="ISO week string e.g. 2026-W23 (default: current week)"
    ),
    outlet_id: UUID | None = Query(None, description="Filter by outlet"),
    db: AsyncSession = Depends(get_db),
) -> WeeklyReportResponse:
    """Return weekly sales report aggregated for the ISO week."""
    if week is None:
        today = datetime.now(UTC).date()
        iso_year, iso_week, _ = today.isocalendar()
        week = f"{iso_year}-W{iso_week:02d}"
    return await get_weekly_report(db, week, outlet_id)


@router.get("/monthly", response_model=MonthlyReportResponse)
async def monthly_report(
    month: str | None = Query(
        None, description="Month string e.g. 2026-06 (default: current month)"
    ),
    outlet_id: UUID | None = Query(None, description="Filter by outlet"),
    db: AsyncSession = Depends(get_db),
) -> MonthlyReportResponse:
    """Return monthly sales report with change vs previous month."""
    if month is None:
        today = datetime.now(UTC).date()
        month = f"{today.year}-{today.month:02d}"
    return await get_monthly_report(db, month, outlet_id)


@router.get("/products", response_model=ProductReportResponse)
async def product_report(
    date_from: date = Query(..., description="Start date (inclusive)"),
    date_to: date = Query(..., description="End date (inclusive)"),
    outlet_id: UUID | None = Query(None, description="Filter by outlet"),
    db: AsyncSession = Depends(get_db),
) -> ProductReportResponse:
    """Return product performance and category breakdown for a date range."""
    return await get_product_report(db, date_from, date_to, outlet_id)


@router.get("/staff", response_model=StaffReportResponse)
async def staff_report(
    date_from: date = Query(..., description="Start date (inclusive)"),
    date_to: date = Query(..., description="End date (inclusive)"),
    outlet_id: UUID | None = Query(None, description="Filter by outlet"),
    db: AsyncSession = Depends(get_db),
) -> StaffReportResponse:
    """Return staff performance metrics for a date range."""
    return await get_staff_report(db, date_from, date_to, outlet_id)


@router.get("/outlets", response_model=OutletReportResponse)
async def outlet_report(
    date_from: date = Query(..., description="Start date (inclusive)"),
    date_to: date = Query(..., description="End date (inclusive)"),
    db: AsyncSession = Depends(get_db),
) -> OutletReportResponse:
    """Return outlet comparison report for a date range."""
    return await get_outlet_report(db, date_from, date_to)