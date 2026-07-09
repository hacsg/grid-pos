"""Sales analytics dashboard API route."""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.staff import Staff
from app.schemas.analytics import AnalyticsDashboardResponse
from app.schemas.flavor_analytics import FlavorAnalysisResponse, FlavorRankingsResponse
from app.services.analytics import get_analytics_dashboard, resolve_date_range
from app.services.flavor_analytics import get_flavor_analysis, get_flavor_rankings
from app.utils.auth import get_current_staff

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dashboard", response_model=AnalyticsDashboardResponse)
async def analytics_dashboard(
    outlet_id: UUID | None = Query(None, description="Filter by outlet"),
    days: int | None = Query(None, ge=1, le=730, description="Rolling window ending today (SGT)"),
    from_date: date | None = Query(None, description="Start date, SGT (inclusive)"),
    to_date: date | None = Query(None, description="End date, SGT (inclusive)"),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> AnalyticsDashboardResponse:
    """Return the full sales-analytics dashboard payload for a date range.

    Explicit from/to wins over `days`; with neither, the response covers all
    recorded sales (and KPI deltas are omitted).
    """
    resolved_from, resolved_to = resolve_date_range(from_date, to_date, days)
    return await get_analytics_dashboard(
        db, outlet_id=outlet_id, from_date=resolved_from, to_date=resolved_to
    )


@router.get("/flavors", response_model=FlavorAnalysisResponse)
async def flavor_analysis(
    outlet_id: UUID | None = Query(None, description="Filter by outlet"),
    days: int | None = Query(None, ge=1, le=730, description="Rolling window ending today (SGT)"),
    from_date: date | None = Query(None, description="Start date, SGT (inclusive)"),
    to_date: date | None = Query(None, description="End date, SGT (inclusive)"),
    granularity: Literal["daily", "weekly", "monthly"] = Query("weekly"),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> FlavorAnalysisResponse:
    """Flavour performance matrix, Pareto concentration, and day-of-week heatmap.

    Flavours are extracted from order-item modifier snapshots (group-prefixed
    names); non-flavour modifiers are reported separately as add-ons.
    """
    resolved_from, resolved_to = resolve_date_range(from_date, to_date, days)
    return await get_flavor_analysis(
        db,
        outlet_id=outlet_id,
        from_date=resolved_from,
        to_date=resolved_to,
        granularity=granularity,
    )


@router.get("/flavor-rankings", response_model=FlavorRankingsResponse)
async def flavor_rankings(
    outlet_id: UUID | None = Query(None, description="Filter by outlet"),
    from_date: date | None = Query(None, description="Start date, SGT (inclusive)"),
    to_date: date | None = Query(None, description="End date, SGT (inclusive)"),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> FlavorRankingsResponse:
    """Monthly flavour ranking trends over all recorded history (or a range)."""
    return await get_flavor_rankings(db, outlet_id=outlet_id, from_date=from_date, to_date=to_date)
