"""Response schemas for the sales analytics dashboard."""

from pydantic import BaseModel


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
