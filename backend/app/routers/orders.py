"""Order management API routes."""

from datetime import UTC, datetime, date, time, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.order import Order, OrderStatus
from app.schemas.order import (
    OrderAddItem,
    OrderCreate,
    OrderItemRead,
    OrderRead,
    OrderRefundCreate,
    OrderStatusUpdate,
    OrderSummaryRead,
)
from app.services.orders import (
    add_item_to_order_service,
    create_order as create_order_service,
    load_order_or_404,
    refund_order_service,
    remove_item_from_order_service,
    update_order_status_service,
)

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderRead, status_code=201)
async def create_order(payload: OrderCreate, db: AsyncSession = Depends(get_db)) -> Order:
    """Create an order with calculated totals and line items."""
    return await create_order_service(db, payload)


@router.get("", response_model=list[OrderSummaryRead])
async def list_orders(
    outlet_id: UUID | None = None,
    staff_id: UUID | None = None,
    status: OrderStatus | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    """List orders with optional filters."""
    statement = select(Order)
    if outlet_id is not None:
        statement = statement.where(Order.outlet_id == outlet_id)
    if staff_id is not None:
        statement = statement.where(Order.staff_id == staff_id)
    if status is not None:
        statement = statement.where(Order.status == status)
    if date_from is not None:
        dt_from = datetime.combine(date_from, time.min, tzinfo=UTC)
        statement = statement.where(Order.created_at >= dt_from)
    if date_to is not None:
        dt_to = datetime.combine(date_to, time.max, tzinfo=UTC)
        statement = statement.where(Order.created_at <= dt_to)
    statement = statement.order_by(Order.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/today", response_model=list[OrderSummaryRead])
async def list_today_orders(
    outlet_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    """Get today's orders, optionally filtered by outlet."""
    today = datetime.now(UTC)
    day_start = datetime.combine(today.date(), time.min, tzinfo=UTC)
    day_end = day_start + timedelta(days=1)

    statement = select(Order).where(
        Order.created_at >= day_start,
        Order.created_at < day_end,
    )
    if outlet_id is not None:
        statement = statement.where(Order.outlet_id == outlet_id)
    statement = statement.order_by(Order.created_at.desc())
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/{order_id}", response_model=OrderRead)
async def get_order(order_id: UUID, db: AsyncSession = Depends(get_db)) -> Order:
    """Return one order with its items."""
    return await load_order_or_404(db, order_id)


@router.put("/{order_id}/status", response_model=OrderRead)
async def update_order_status(
    order_id: UUID,
    payload: OrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
) -> Order:
    """Update an order status and payment metadata."""
    return await update_order_status_service(
        db,
        order_id,
        payload.status,
        payment_method=payload.payment_method,
        payment_reference=payload.payment_reference,
    )


@router.post("/{order_id}/refund", response_model=OrderRead)
async def refund_order(
    order_id: UUID,
    payload: OrderRefundCreate = OrderRefundCreate(),
    db: AsyncSession = Depends(get_db),
) -> Order:
    """Process a full refund on a paid order."""
    return await refund_order_service(db, order_id, reason=payload.reason)


@router.post("/{order_id}/items", response_model=OrderRead, status_code=201)
async def add_order_item(
    order_id: UUID,
    payload: OrderAddItem,
    db: AsyncSession = Depends(get_db),
) -> Order:
    """Add an item to a pending order."""
    return await add_item_to_order_service(db, order_id, payload)


@router.delete("/{order_id}/items/{item_id}", response_model=OrderRead)
async def remove_order_item(
    order_id: UUID,
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> Order:
    """Remove an item from a pending order."""
    return await remove_item_from_order_service(db, order_id, item_id)