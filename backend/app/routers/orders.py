"""Order management API routes."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.order import Order, OrderStatus
from app.schemas.order import OrderCreate, OrderRead, OrderStatusUpdate, OrderSummaryRead
from app.services.orders import create_order as create_order_service
from app.services.orders import load_order_or_404

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderRead, status_code=201)
async def create_order(payload: OrderCreate, db: AsyncSession = Depends(get_db)) -> Order:
    """Create an order with calculated totals and line items."""
    return await create_order_service(db, payload)


@router.get("", response_model=list[OrderSummaryRead])
async def list_orders(
    outlet_id: UUID | None = None,
    status: OrderStatus | None = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    """List orders with optional outlet and status filters."""
    statement = select(Order)
    if outlet_id is not None:
        statement = statement.where(Order.outlet_id == outlet_id)
    if status is not None:
        statement = statement.where(Order.status == status)
    statement = statement.order_by(Order.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/{order_id}", response_model=OrderRead)
async def get_order(order_id: UUID, db: AsyncSession = Depends(get_db)) -> Order:
    """Return one order with its items."""
    return await load_order_or_404(db, order_id)


@router.patch("/{order_id}/status", response_model=OrderRead)
async def update_order_status(
    order_id: UUID,
    payload: OrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
) -> Order:
    """Update an order status and payment metadata."""
    order = await load_order_or_404(db, order_id)
    order.status = payload.status
    order.payment_method = payload.payment_method
    order.payment_reference = payload.payment_reference
    await db.commit()
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == order.id)
    )
    return result.scalar_one()

