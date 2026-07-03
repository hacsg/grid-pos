"""Voucher validation, creation, and application logic."""

from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP
import logging
import secrets
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.models.order import Order, OrderStatus
from app.models.staff import Staff
from app.models.voucher import OrderVoucher, Voucher, VoucherType
from app.services.plotholders_client import PlotholdersAPIError, PlotholdersClient

CENT = Decimal("0.01")
logger = logging.getLogger(__name__)


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


async def get_voucher_by_code(
    db: AsyncSession,
    code: str,
    *,
    for_update: bool = False,
) -> Voucher | None:
    statement = select(Voucher).where(Voucher.code == code.strip())
    if for_update:
        statement = statement.with_for_update()

    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def create_voucher(
    db: AsyncSession,
    *,
    code: str,
    type: VoucherType,
    amount: Decimal | None,
) -> Voucher:
    """Create a new voucher (primarily for CDC seeding by admins)."""
    normalized = code.strip()
    existing = await get_voucher_by_code(db, normalized)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Voucher code already exists",
        )
    if amount is not None and amount < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Voucher amount must be greater than or equal to zero",
        )
    normalized_amount = quantize_money(amount) if amount is not None else Decimal("0")
    voucher = Voucher(code=normalized, type=type, amount=normalized_amount)
    db.add(voucher)
    await db.commit()
    await db.refresh(voucher)
    return voucher


async def issue_voucher(
    db: AsyncSession,
    *,
    customer_id: UUID,
    campaign_id: UUID,
    code_prefix: str,
    discount_cents: int,
    expires_at: datetime | None = None,
    commit: bool = True,
) -> Voucher:
    """Issue a campaign voucher to a customer."""
    if discount_cents <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Voucher discount must be greater than zero",
        )

    prefix = code_prefix.strip().upper()
    if not prefix:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Campaign code prefix is required",
        )

    code = ""
    for _ in range(10):
        candidate = f"{prefix}-{secrets.token_hex(4).upper()}"
        if await get_voucher_by_code(db, candidate) is None:
            code = candidate
            break
    if not code:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to generate a unique voucher code",
        )

    amount = quantize_money(Decimal(discount_cents) / Decimal(100))
    voucher = Voucher(
        code=code,
        type=VoucherType.acre_group,
        amount=amount,
        customer_id=customer_id,
        campaign_id=campaign_id,
        discount_cents=discount_cents,
        status="available",
        expires_at=expires_at,
    )
    db.add(voucher)
    if commit:
        await db.commit()
        await db.refresh(voucher)
    else:
        await db.flush()
    return voucher


def _parse_voucher_amount(amount_raw: object) -> Decimal:
    """Parse a Plotholders voucher amount or raise 422."""
    try:
        return quantize_money(Decimal(str(amount_raw)))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Voucher amount could not be determined",
        ) from exc


async def apply_vouchers_to_order(
    db: AsyncSession,
    *,
    order_id: UUID,
    codes: list[str],
    staff: Staff | None = None,
    plotholders: PlotholdersClient | None = None,
) -> list[OrderVoucher]:
    """Apply one or more voucher codes to a pending order.

    Validates via Plotholders, creates local OrderVoucher records (and minimal voucher rows for FKs),
    marks redeemed locally, updates order total. Plotholders remains source of truth for issuance/redemption.
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
    collected: list[tuple[Voucher, Decimal, str]] = []
    total_voucher_amount = Decimal("0.00")
    remaining_total = order.total
    outlet_name = ""

    # Phase 1: validate and collect (no external redeem yet).
    for raw_code in codes:
        normalized = raw_code.strip()
        if not normalized:
            continue

        try:
            external = await client.get_voucher(normalized)
        except PlotholdersAPIError as exc:
            if exc.status_code and 400 <= exc.status_code < 500:
                raise HTTPException(status_code=exc.status_code, detail=exc.response_body or "Invalid voucher") from exc
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to verify voucher") from exc

        if not external:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voucher not found")

        redeemed = external.get("redeemed_at") or external.get("redeemed") or external.get("is_redeemed")
        if redeemed:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Voucher {normalized} has already been redeemed")

        amount_raw = external.get("amount") or external.get("value") or external.get("discount") or 0
        amount = _parse_voucher_amount(amount_raw)
        amount = min(amount, remaining_total)
        if amount <= 0:
            continue

        voucher = await get_voucher_by_code(db, normalized, for_update=True)
        if voucher is None:
            vtype = VoucherType.acre_group
            if external.get("type") == "cdc":
                vtype = VoucherType.cdc
            voucher = Voucher(code=normalized, type=vtype, amount=amount)
            db.add(voucher)
            try:
                await db.flush()
            except IntegrityError as exc:
                await db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Voucher already applied to another order",
                ) from exc

        if voucher.redeemed_at is not None or voucher.order_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Voucher {voucher.code} has already been redeemed",
            )

        collected.append((voucher, amount, normalized))
        total_voucher_amount += amount
        remaining_total = quantize_money(remaining_total - amount)

    if not collected:
        return []

    # Phase 2: persist locally and commit before any external side effects.
    now = datetime.now(UTC)
    applied: list[OrderVoucher] = []
    for voucher, amount, _normalized in collected:
        voucher.redeemed_at = now
        voucher.status = "redeemed"
        voucher.redeemed_by_staff_id = staff.id if staff else None
        voucher.outlet_id = order.outlet_id
        voucher.order_id = order.id
        voucher.redeemed_order_id = order.id

        link = OrderVoucher(
            order_id=order.id,
            voucher_id=voucher.id,
            amount_applied=amount,
        )
        db.add(link)
        applied.append(link)

    loyalty_discount = order.loyalty_discount or Decimal("0.00")
    new_total = quantize_money(order.subtotal - loyalty_discount - total_voucher_amount)
    if new_total < 0:
        new_total = Decimal("0.00")
    order.total = new_total

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Voucher already applied to another order",
        ) from exc

    # Phase 3: external redeem only after local commit succeeds.
    staff_id = str(staff.id) if staff else ""
    for voucher, _amount, normalized in collected:
        try:
            await client.redeem_voucher_by_code(
                normalized, staff_id, outlet_name or str(order.outlet_id or "")
            )
        except PlotholdersAPIError as exc:
            logger.error(
                "Plotholders redeem failed after local commit: voucher_id=%s, code=%s, error=%s",
                voucher.id,
                voucher.code,
                exc,
            )

    for link in applied:
        await db.refresh(link)

    return applied


async def list_vouchers(
    db: AsyncSession,
    *,
    type: VoucherType | None = None,
    redeemed: bool | None = None,
    campaign_id: UUID | None = None,
    outlet_id: UUID | None = None,
    order_id: UUID | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Voucher]:
    stmt = (
        select(Voucher)
        .options(selectinload(Voucher.customer), selectinload(Voucher.campaign))
        .order_by(Voucher.created_at.desc())
    )
    if type is not None:
        stmt = stmt.where(Voucher.type == type)
    if redeemed is True:
        stmt = stmt.where(Voucher.redeemed_at.is_not(None))
    elif redeemed is False:
        stmt = stmt.where(Voucher.redeemed_at.is_(None))
    if campaign_id is not None:
        stmt = stmt.where(Voucher.campaign_id == campaign_id)
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
