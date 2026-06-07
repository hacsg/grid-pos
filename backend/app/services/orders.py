"""Order creation and order-numbering business logic."""

from datetime import UTC, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Integer, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.category import Category
from app.models.order import Order
from app.models.order_item import OrderItem
from app.models.outlet import Outlet
from app.models.product import Product
from app.models.staff import Staff
from app.schemas.order import OrderCreate

CENT = Decimal("0.01")


def quantize_money(value: Decimal) -> Decimal:
    """Round a Decimal value to two places for persisted money fields."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


async def _acquire_order_number_lock(db: AsyncSession, outlet_id: UUID, order_date: datetime) -> None:
    """Acquire a PostgreSQL transaction lock for outlet/day order numbering."""
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return
    lock_key = f"order-number:{outlet_id}:{order_date.date().isoformat()}"
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"), {"lock_key": lock_key})


async def next_order_number(db: AsyncSession, outlet_id: UUID, now: datetime | None = None) -> str:
    """Return the next four-digit order number for an outlet on a calendar day."""
    current_time = now or datetime.now(UTC)
    day_start = datetime.combine(current_time.date(), time.min, tzinfo=UTC)
    day_end = day_start + timedelta(days=1)

    await _acquire_order_number_lock(db, outlet_id, current_time)

    result = await db.execute(
        select(func.max(cast(Order.order_number, Integer))).where(
            Order.outlet_id == outlet_id,
            Order.created_at >= day_start,
            Order.created_at < day_end,
        )
    )
    max_order_number = result.scalar_one_or_none() or 0
    return f"{max_order_number + 1:04d}"


async def _load_available_product(db: AsyncSession, product_id: UUID, outlet_id: UUID) -> Product:
    """Load a product and validate that it can be sold at the outlet."""
    result = await db.execute(
        select(Product)
        .options(selectinload(Product.category))
        .where(Product.id == product_id)
    )
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if not product.is_available:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product is unavailable")
    if product.category.outlet_id is not None and product.category.outlet_id != outlet_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Product does not belong to the selected outlet",
        )
    return product


async def create_order(db: AsyncSession, payload: OrderCreate) -> Order:
    """Create an order, calculate totals, and persist its order items."""
    outlet = await db.get(Outlet, payload.outlet_id)
    if outlet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outlet not found")

    staff = await db.get(Staff, payload.staff_id)
    if staff is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found")
    if not staff.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Staff member is inactive")
    if staff.outlet_id != payload.outlet_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Staff member does not belong to the selected outlet",
        )

    order_number = await next_order_number(db, payload.outlet_id)
    order = Order(
        order_number=order_number,
        outlet_id=payload.outlet_id,
        staff_id=payload.staff_id,
        subtotal=Decimal("0.00"),
        total=Decimal("0.00"),
        status=payload.status,
        payment_method=payload.payment_method,
        payment_reference=payload.payment_reference,
    )

    subtotal = Decimal("0.00")
    for item in payload.items:
        product = await _load_available_product(db, item.product_id, payload.outlet_id)
        modifier_total = sum((modifier.price_adjustment for modifier in item.modifiers), Decimal("0.00"))
        unit_price = quantize_money(product.price + modifier_total)
        line_total = quantize_money(unit_price * item.quantity)
        subtotal += line_total
        order.items.append(
            OrderItem(
                product_id=product.id,
                quantity=item.quantity,
                unit_price=unit_price,
                modifiers=[
                    modifier.model_dump(mode="json")
                    for modifier in item.modifiers
                ],
                notes=item.notes,
            )
        )

    order.subtotal = quantize_money(subtotal)
    order.total = order.subtotal
    db.add(order)
    await db.commit()

    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == order.id)
    )
    return result.scalar_one()


async def load_order_or_404(db: AsyncSession, order_id: UUID) -> Order:
    """Load an order with items or raise a 404 response."""
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == order_id)
    )
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order

