"""Order creation and order-numbering business logic."""

from datetime import UTC, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Integer, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.category import Category
from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.models.outlet import Outlet
from app.models.product import Product
from app.models.staff import Staff
from app.schemas.order import OrderCreate, OrderItemCreate

CENT = Decimal("0.01")

# Valid status transitions: current -> set of allowed next statuses
_ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.pending: {OrderStatus.paid, OrderStatus.cancelled},
    OrderStatus.paid: {OrderStatus.refunded, OrderStatus.cancelled},
}


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


def _compute_item_unit_price(product: Product, item: OrderItemCreate | None, modifier_total: Decimal | None = None) -> Decimal:
    """Compute the unit price for an order item including modifiers."""
    mod_total: Decimal
    if modifier_total is not None:
        mod_total = modifier_total
    else:
        mod_total = sum((m.price_adjustment for m in item.modifiers), Decimal("0.00")) if item else Decimal("0.00")
    return quantize_money(product.price + mod_total)


async def _build_order_item(db: AsyncSession, item: OrderItemCreate, outlet_id: UUID) -> tuple[OrderItem, Decimal]:
    """Build an OrderItem from a creation payload, returning (item, line_total)."""
    product = await _load_available_product(db, item.product_id, outlet_id)
    modifier_total = sum((m.price_adjustment for m in item.modifiers), Decimal("0.00"))
    unit_price = _compute_item_unit_price(product, item, modifier_total)
    line_total = quantize_money(unit_price * item.quantity)
    order_item = OrderItem(
        product_id=product.id,
        quantity=item.quantity,
        unit_price=unit_price,
        modifiers=[m.model_dump(mode="json") for m in item.modifiers],
        notes=item.notes,
    )
    return order_item, line_total


async def _recalculate_order_totals(db: AsyncSession, order: Order) -> None:
    """Recalculate subtotal and total from the order's existing items."""
    subtotal = Decimal("0.00")
    for item in order.items:
        line_total = quantize_money(item.unit_price * item.quantity)
        subtotal += line_total
    order.subtotal = quantize_money(subtotal)
    discount = order.loyalty_discount or Decimal("0.00")
    order.total = quantize_money(subtotal - discount)


def _validate_order_not_paid(order: Order) -> None:
    """Raise 400 if the order is already paid or beyond."""
    if order.status != OrderStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify items after order is paid",
        )


def _validate_status_transition(order: Order, new_status: OrderStatus) -> None:
    """Raise 400 if the requested status transition is not allowed."""
    allowed = _ALLOWED_TRANSITIONS.get(order.status)
    if allowed is None or new_status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot transition order from '{order.status.value}' to '{new_status.value}'",
        )


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
        loyalty_member_id=payload.loyalty_member_id,
        loyalty_points_redeemed=payload.loyalty_points_redeemed,
        loyalty_discount=payload.loyalty_discount,
    )

    subtotal = Decimal("0.00")
    for item in payload.items:
        order_item, line_total = await _build_order_item(db, item, payload.outlet_id)
        subtotal += line_total
        order.items.append(order_item)

    order.subtotal = quantize_money(subtotal)
    discount = payload.loyalty_discount or Decimal("0.00")
    order.total = quantize_money(subtotal - discount)
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


async def update_order_status_service(
    db: AsyncSession,
    order_id: UUID,
    new_status: OrderStatus,
    payment_method: str | None = None,
    payment_reference: str | None = None,
) -> Order:
    """Update order status with transition validation."""
    order = await load_order_or_404(db, order_id)
    _validate_status_transition(order, new_status)
    order.status = new_status
    if payment_method is not None:
        order.payment_method = payment_method
    if payment_reference is not None:
        order.payment_reference = payment_reference
    await db.commit()

    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == order.id)
    )
    return result.scalar_one()


async def refund_order_service(
    db: AsyncSession,
    order_id: UUID,
    reason: str | None = None,
) -> Order:
    """Process a full refund on a paid order."""
    order = await load_order_or_404(db, order_id)
    if order.status != OrderStatus.paid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot refund an order that is not paid",
        )
    order.status = OrderStatus.refunded
    await db.commit()

    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == order.id)
    )
    return result.scalar_one()


async def add_item_to_order_service(db: AsyncSession, order_id: UUID, item: OrderItemCreate) -> Order:
    """Add an item to a pending order and recalculate totals."""
    order = await load_order_or_404(db, order_id)
    _validate_order_not_paid(order)

    order_item, line_total = await _build_order_item(db, item, order.outlet_id)
    order.items.append(order_item)
    await _recalculate_order_totals(db, order)
    await db.commit()

    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == order.id)
    )
    return result.scalar_one()


async def remove_item_from_order_service(db: AsyncSession, order_id: UUID, item_id: UUID) -> Order:
    """Remove an item from a pending order and recalculate totals."""
    order = await load_order_or_404(db, order_id)
    _validate_order_not_paid(order)

    match = [oi for oi in order.items if oi.id == item_id]
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order item not found",
        )
    order.items.remove(match[0])
    await _recalculate_order_totals(db, order)
    await db.commit()

    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == order.id)
    )
    return result.scalar_one()