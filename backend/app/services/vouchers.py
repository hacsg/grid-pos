"""Voucher validation, creation, and application logic."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.order import Order, OrderStatus
from app.models.staff import Staff
from app.models.voucher import OrderVoucher, Voucher, VoucherType
from app.services.plotholders_client import PlotholdersAPIError, PlotholdersClient

CENT = Decimal("0.01")


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(CENT)


async def get_voucher_by_code(db: AsyncSession, code: str) -> Voucher | None:
    result = await db.execute(select(Voucher).where(Voucher.code == code.strip()))
    return result.scalar_one_or_none()


async def create_voucher(
    db: AsyncSession,
    *,
    code: str,
    type: VoucherType,
    amount: Decimal,
) -> Voucher:
    """Create a new voucher (primarily for CDC seeding by admins)."""
    normalized = code.strip()
    existing = await get_voucher_by_code(db, normalized)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Voucher code already exists",
        )
    if amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Voucher amount must be greater than zero",
        )
    voucher = Voucher(code=normalized, type=type, amount=quantize_money(amount))
    db.add(voucher)
    await db.commit()
    await db.refresh(voucher)
    return voucher


async def validate_voucher_code(
    db: AsyncSession,
    code: str,
    plotholders: PlotholdersClient | None = None,
) -> Voucher:
    """Validate a voucher code.

    - Looks up locally first.
    - If not found, attempts Plotholders lookup (for Acre Group vouchers) and auto-creates a local record.
    - Ensures the voucher has not been redeemed.
    """
    normalized = code.strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Voucher code is required")

    local = await get_voucher_by_code(db, normalized)
    if local:
        if local.redeemed_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Voucher has already been redeemed",
            )
        return local

    # Not in local DB — try Plotholders (Acre Group / external)
    client = plotholders or PlotholdersClient()
    try:
        external = await client.get_voucher(normalized)
    except PlotholdersAPIError as exc:
        # Surface upstream errors for AG codes that are invalid at source
        if exc.status_code and 400 <= exc.status_code < 500:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.response_body or "Invalid voucher",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to verify voucher with external provider",
        ) from exc

    if not external:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voucher not found",
        )

    # Determine if already redeemed on Plotholders side
    redeemed = external.get("redeemed_at") or external.get("redeemed") or external.get("is_redeemed")
    if redeemed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Voucher has already been redeemed",
        )

    # Extract amount — prefer explicit fields
    amount_raw = external.get("amount") or external.get("value") or external.get("discount") or 0
    try:
        amount = quantize_money(Decimal(str(amount_raw)))
    except Exception:
        amount = quantize_money(Decimal("0.00"))

    if amount <= 0:
        # Some external vouchers may not expose amount; default to 0 and let admin override or reject
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Voucher has no usable amount",
        )

    # Auto-provision local Acre Group voucher record
    voucher = Voucher(
        code=normalized,
        type=VoucherType.acre_group,
        amount=amount,
    )
    # If external has an id different from code, we still use entered code for redeem calls
    db.add(voucher)
    await db.commit()
    await db.refresh(voucher)
    return voucher


async def apply_vouchers_to_order(
    db: AsyncSession,
    *,
    order_id: UUID,
    codes: list[str],
    staff: Staff | None = None,
    plotholders: PlotholdersClient | None = None,
) -> list[OrderVoucher]:
    """Apply one or more voucher codes to a pending order.

    Creates OrderVoucher rows, marks vouchers redeemed, updates order totals.
    Returns the list of OrderVoucher links created.
    """
    order = await db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.status != OrderStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot apply vouchers to a paid or closed order",
        )

    client = plotholders or PlotholdersClient()
    applied: list[OrderVoucher] = []
    total_voucher_amount = Decimal("0.00")

    for raw_code in codes:
        voucher = await validate_voucher_code(db, raw_code, client)

        # Re-check not already linked to this or any order (defensive)
        if voucher.redeemed_at is not None or voucher.order_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Voucher {voucher.code} has already been redeemed",
            )

        amount = quantize_money(voucher.amount)
        total_voucher_amount += amount

        # Mark voucher redeemed
        now = datetime.now(UTC)
        voucher.redeemed_at = now
        voucher.redeemed_by_staff_id = staff.id if staff else None
        voucher.outlet_id = order.outlet_id
        voucher.order_id = order.id

        link = OrderVoucher(
            order_id=order.id,
            voucher_id=voucher.id,
            amount_applied=amount,
        )
        db.add(link)
        applied.append(link)

    if not applied:
        return applied

    # Update order totals: total = subtotal - loyalty_discount - voucher amounts (floored at 0)
    loyalty_discount = order.loyalty_discount or Decimal("0.00")
    new_total = quantize_money(order.subtotal - loyalty_discount - total_voucher_amount)
    if new_total < 0:
        new_total = Decimal("0.00")
    order.total = new_total

    await db.commit()

    # Refresh links with voucher info if needed by caller
    for link in applied:
        await db.refresh(link)

    return applied


async def list_vouchers(
    db: AsyncSession,
    *,
    type: VoucherType | None = None,
    redeemed: bool | None = None,
    outlet_id: UUID | None = None,
    order_id: UUID | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Voucher]:
    stmt = select(Voucher).order_by(Voucher.created_at.desc())
    if type is not None:
        stmt = stmt.where(Voucher.type == type)
    if redeemed is True:
        stmt = stmt.where(Voucher.redeemed_at.is_not(None))
    elif redeemed is False:
        stmt = stmt.where(Voucher.redeemed_at.is_(None))
    if outlet_id is not None:
        stmt = stmt.where(Voucher.outlet_id == outlet_id)
    if order_id is not None:
        stmt = stmt.where(Voucher.order_id == order_id)
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def load_applied_vouchers_for_order(db: AsyncSession, order_id: UUID) -> list[dict]:
    """Return lightweight applied voucher info for an order (for responses)."""
    result = await db.execute(
        select(OrderVoucher, Voucher)
        .join(Voucher, OrderVoucher.voucher_id == Voucher.id)
        .where(OrderVoucher.order_id == order_id)
        .order_by(OrderVoucher.created_at.asc())
    )
    rows = result.all()
    return [
        {
            "id": str(link.id),
            "voucher_id": str(voucher.id),
            "code": voucher.code,
            "type": voucher.type.value,
            "amount_applied": float(link.amount_applied),
            "created_at": link.created_at.isoformat() if link.created_at else None,
        }
        for link, voucher in rows
    ]
