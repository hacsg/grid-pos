"""Response schemas for the sales analytics dashboard."""

from pydantic import BaseModel


class MonthEndOutletForecast(BaseModel):
    """One visible outlet's current earned vs projected full-month target."""

    outlet_id: str
    outlet_name: str
    projected_total: float
    earned_so_far: float
    remaining: float
    method: str = "run_rate_fallback"
    history_days: int = 0
    # Actual vs model-expected sales on completed days so far this month.
    # Positive => ahead of historical trend; negative => behind; None => no basis.
    pace_variance_pct: float | None = None


class AnalyticsKpis(BaseModel):
    """Headline totals for the selected period, with % change vs the previous period.

    Deltas are None when there is no comparison period (all-time view) or the
    previous period had no sales.
    """

    gross_sales: float
    net_sales: float
    transactions: int
    items_sold: int
    avg_ticket: float
    gross_sales_delta: float | None = None
    net_sales_delta: float | None = None
    transactions_delta: float | None = None
    items_sold_delta: float | None = None
    avg_ticket_delta: float | None = None
    # Month-end prediction (current month only, SGT).
    # projected_total: total net sales projected for the full month
    # earned_so_far:   actual net sales for the current month to date.
    # remaining:       projected_total - earned_so_far
    month_end_projected_total: float = 0.0
    month_end_earned_so_far: float = 0.0
    month_end_remaining: float = 0.0
    month_end_method: str = "run_rate_fallback"
    month_end_history_days: int = 0
    month_end_sample_count: int = 0
    # Per-outlet current/target breakdown for the current month (empty otherwise).
    month_end_outlets: list[MonthEndOutletForecast] = []
    # Group actual-vs-expected pace variance % for completed days this month.
    month_end_pace_variance_pct: float | None = None
    # Operational attach metrics over the selected range (waffle/drink attach
    # rate as % of paid orders; pints = units sold).
    waffle_attach_rate: float = 0.0
    drink_attach_rate: float = 0.0
    pints_sold: int = 0


class PaymentBreakdownItem(BaseModel):
    method: str
    amount: float


class OutletSalesItem(BaseModel):
    outlet_id: str
    outlet_name: str
    net_sales: float
    transactions: int


class TrendPoint(BaseModel):
    date: str
    net_sales: float
    transactions: int


class TopProductItem(BaseModel):
    product_id: str
    name: str
    quantity: int
    revenue: float


class DayOfWeekPoint(BaseModel):
    day: str
    avg_sales: float
    avg_transactions: float


class HourlyPoint(BaseModel):
    hour: int
    revenue: float
    transactions: int
    avg_sales: float


class ConcentrationData(BaseModel):
    top3_pct: float
    top5_pct: float
    total_products: int


class ScoopRatioData(BaseModel):
    single_qty: int
    double_qty: int
    single_pct: float
    double_pct: float


class RedemptionTypeBreakdown(BaseModel):
    type: str
    count: int
    value: float


class CdcRedemptions(BaseModel):
    """Government CDC amounts keyed in at checkout (orders.cdc_amount > 0)."""

    orders: int
    value: float


class VoucherRedemptions(BaseModel):
    """Scanned voucher redemptions from order_vouchers."""

    count: int
    value: float
    by_type: list[RedemptionTypeBreakdown]


class RedemptionsData(BaseModel):
    cdc: CdcRedemptions
    vouchers: VoucherRedemptions


class AnalyticsDashboardResponse(BaseModel):
    date_from: str
    date_to: str
    kpis: AnalyticsKpis
    payments: list[PaymentBreakdownItem]
    sales_by_outlet: list[OutletSalesItem]
    trend: list[TrendPoint]
    top_by_revenue: list[TopProductItem]
    top_by_quantity: list[TopProductItem]
    day_of_week: list[DayOfWeekPoint]
    hourly: list[HourlyPoint]
    concentration: ConcentrationData
    scoop_ratio: ScoopRatioData
    redemptions: RedemptionsData
