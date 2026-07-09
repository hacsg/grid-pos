"""Response schemas for flavour analytics."""

from pydantic import BaseModel


class FlavorTrendPoint(BaseModel):
    bucket: str
    qty: int


class FlavorOutletQty(BaseModel):
    outlet_id: str
    outlet_name: str
    qty: int
    share_pct: float


class FlavorItem(BaseModel):
    name: str
    total_qty: int
    share_pct: float
    rank: int
    trend_pct: float
    classification: str  # hero | rising | stable | rotate_out
    days_sold: int
    active_days: int
    consistency_pct: float
    trend: list[FlavorTrendPoint]
    by_outlet: list[FlavorOutletQty]


class ParetoPoint(BaseModel):
    name: str
    quantity: int
    share_pct: float
    cumulative_pct: float


class FlavorDowRow(BaseModel):
    name: str
    quantities: list[int]  # Monday..Sunday


class FlavorAnalysisResponse(BaseModel):
    date_from: str
    date_to: str
    active_days: int
    flavors: list[FlavorItem]
    addons: list[FlavorItem]
    pareto: list[ParetoPoint]
    day_of_week: list[FlavorDowRow]


class FlavorRankingItem(BaseModel):
    name: str
    monthly_rank: list[int | None]
    monthly_qty: list[int]
    rank_change: int | None
    avg_rank: float
    classification: str  # consistent_top | rising | stable | dropping | consistent_bottom


class FlavorRankingsResponse(BaseModel):
    months: list[str]
    flavors: list[FlavorRankingItem]
