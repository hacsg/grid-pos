"""Order management API routes."""

from datetime import UTC, datetime, date, time, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.order import Order, OrderStatus
from app.models.staff import Staff
from app.services import idempotency
from app.schemas.order import (
    OrderAddItem,
    OrderCreate,
    OrderItemRead,
    OrderRead,
    OrderRefundCreate,
    OrderStatusUpdate,
    OrderSummaryRead,
)
from app.schemas.voucher import VoucherApplyRequest
from app.services.orders import (
    add_item_to_order_service,
    create_order as create_order_service,
    load_order_or_404,
    refund_order_service,
    remove_item_from_order_service,
    update_order_status_service,
)
from app.services.vouchers import apply_vouchers_to_order, load_applied_vouchers_for_order
from app.utils.auth import get_current_staff

router = APIRouter(prefix="/orders", tags=["orders"])

_MANAGER_ROLES = {"admin", "manager", "supervisor"}


def _ensure_manager_authorized(current_staff: Staff) -> None:
    """Require a manager-equivalent role for refunds and paid reversals."""
    role = getattr(current_staff.role, "value", current_staff.role)
    if str(role) not in _MANAGER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager authorization required",
        )


async def _ensure_status_change_authorized(
    db: AsyncSession,
    order_id: UUID,
    payload: OrderStatusUpdate,
    current_staff: Staff,
) -> None:
    """Gate cancellation and paid-state reversals to manager-equivalent roles."""
    if payload.status == OrderStatus.cancelled:
        _ensure_manager_authorized(current_staff)
        return

    if payload.status != OrderStatus.paid:
        order = await load_order_or_404(db, order_id)
        if order.status == OrderStatus.paid:
            _ensure_manager_authorized(current_staff)


@router.post("", response_model=OrderRead, status_code=201)
async def create_order(
    payload: OrderCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> Order | JSONResponse:
    """Create an order with calculated totals and line items.

    Pass an ``Idempotency-Key`` header to make retries safe: a duplicate request
    with the same key replays the original order instead of creating a second one.
    """
    scope = "orders.create"
    if idempotency_key:
        request_hash = idempotency.fingerprint(payload.model_dump(mode="json"))
        replay = await idempotency.begin(db, scope, idempotency_key, request_hash)
        if replay is not None:
            return JSONResponse(replay.body, status_code=replay.status_code)

    try:
        order = await create_order_service(db, payload)
        body = jsonable_encoder(OrderRead.model_validate(order))
    except Exception:
        if idempotency_key:
            await idempotency.release(db, scope, idempotency_key)
        raise

    if idempotency_key:
        await idempotency.complete(db, scope, idempotency_key, 201, body)
    return JSONResponse(body, status_code=201)


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
    current_staff: Staff = Depends(get_current_staff),
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
    current_staff: Staff = Depends(get_current_staff),
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
async def get_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Order:
    """Return one order with its items."""
    return await load_order_or_404(db, order_id)


@router.put("/{order_id}/status", response_model=OrderRead)
async def update_order_status(
    order_id: UUID,
    payload: OrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> Order | JSONResponse:
    """Update an order status and payment metadata (this is the "pay" action).

    Pass an ``Idempotency-Key`` header so a retried mark-as-paid replays the
    original result instead of erroring on the already-consumed status transition.
    """
    await _ensure_status_change_authorized(db, order_id, payload, current_staff)

    scope = "orders.status"
    if idempotency_key:
        # Bind the key to this order so the same key can't be replayed onto another.
        request_hash = idempotency.fingerprint(
            {"order_id": str(order_id), **payload.model_dump(mode="json")}
        )
        replay = await idempotency.begin(db, scope, idempotency_key, request_hash)
        if replay is not None:
            return JSONResponse(replay.body, status_code=replay.status_code)

    try:
        order = await update_order_status_service(
            db,
            order_id,
            payload.status,
            payment_method=payload.payment_method,
            payment_reference=payload.payment_reference,
            cash_tendered=payload.cash_tendered,
            cash_amount=payload.cash_amount,
            card_amount=payload.card_amount,
            voucher_amount=payload.voucher_amount,
            cdc_amount=payload.cdc_amount,
            paynow_confirmed_at=payload.paynow_confirmed_at,
        )
        body = jsonable_encoder(OrderRead.model_validate(order))
    except Exception:
        if idempotency_key:
            await idempotency.release(db, scope, idempotency_key)
        raise

    if idempotency_key:
        await idempotency.complete(db, scope, idempotency_key, 200, body)
    return JSONResponse(body, status_code=200)


@router.post("/{order_id}/refund", response_model=OrderRead)
async def refund_order(
    order_id: UUID,
    payload: OrderRefundCreate = OrderRefundCreate(),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Order:
    """Process a full refund on a paid order."""
    _ensure_manager_authorized(current_staff)
    return await refund_order_service(db, order_id, reason=payload.reason)


@router.post("/{order_id}/items", response_model=OrderRead, status_code=201)
async def add_order_item(
    order_id: UUID,
    payload: OrderAddItem,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Order:
    """Add an item to a pending order."""
    return await add_item_to_order_service(db, order_id, payload)


@router.delete("/{order_id}/items/{item_id}", response_model=OrderRead)
async def remove_order_item(
    order_id: UUID,
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Order:
    """Remove an item from a pending order."""
    return await remove_item_from_order_service(db, order_id, item_id)
@router.post("/{order_id}/vouchers", response_model=OrderRead)
async def apply_vouchers_to_order_endpoint(
    order_id: UUID,
    payload: VoucherApplyRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Order:
    """Apply voucher codes to a pending order (reduces total, records redemption)."""
    await apply_vouchers_to_order(db, order_id=order_id, codes=payload.codes)
    order = await load_order_or_404(db, order_id)
    return await _enrich_order_response(db, order)


async def _enrich_order_response(db: AsyncSession, order: Order) -> Order:
    """Attach voucher application details to order for response serialization."""
    applied = await load_applied_vouchers_for_order(db, order.id)
    order.applied_vouchers = applied  # type: ignore[attr-defined]
    voucher_sum = sum((a["amount_applied"] for a in applied), 0.0)
    order.voucher_discount = voucher_sum if voucher_sum else None  # type: ignore[attr-defined]
    return order
