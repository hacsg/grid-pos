"""Sales reporting services."""

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order, OrderStatus
from app.schemas.report import DailySalesReport


def _day_bounds(report_date: date) -> tuple[datetime, datetime]:
    """Return UTC datetime bounds for a report date."""
    start = datetime.combine(report_date, time.min, tzinfo=UTC)
    return start, start + timedelta(days=1)


async def get_daily_sales_report(
    db: AsyncSession,
    report_date: date,
    outlet_id: UUID | None = None,
) -> DailySalesReport:
    """Calculate daily sales totals and order counts."""
    start, end = _day_bounds(report_date)
    base_filters = [Order.created_at >= start, Order.created_at < end]
    if outlet_id is not None:
        base_filters.append(Order.outlet_id == outlet_id)

    async def count_for_status(order_status: OrderStatus) -> int:
        """Count orders for a status within the report filters."""
        result = await db.execute(
            select(func.count(Order.id)).where(*base_filters, Order.status == order_status)
        )
        return int(result.scalar_one() or 0)

    async def sum_for_status(order_status: OrderStatus) -> Decimal:
        """Sum order totals for a status within the report filters."""
        result = await db.execute(
            select(func.coalesce(func.sum(Order.total), 0)).where(
                *base_filters,
                Order.status == order_status,
            )
        )
        return Decimal(result.scalar_one() or 0)

    paid_orders = await count_for_status(OrderStatus.paid)
    refunded_orders = await count_for_status(OrderStatus.refunded)
    cancelled_orders = await count_for_status(OrderStatus.cancelled)
    gross_sales = await sum_for_status(OrderStatus.paid)
    refunds = await sum_for_status(OrderStatus.refunded)

    return DailySalesReport(
        report_date=report_date,
        outlet_id=outlet_id,
        paid_orders=paid_orders,
        refunded_orders=refunded_orders,
        cancelled_orders=cancelled_orders,
        gross_sales=gross_sales,
        refunds=refunds,
        net_sales=gross_sales - refunds,
    )
