"""Voucher management and redemption routes."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.staff import Staff, StaffRole
from app.models.voucher import VoucherType
from app.schemas.order import OrderRead
from app.schemas.voucher import (
    VoucherApplyRequest,
    VoucherValidateRead,
    VoucherValidateRequest,
)
from app.services.orders import load_order_or_404
from app.services.plotholders_client import PlotholdersAPIError, PlotholdersClient
from app.services.vouchers import (
    apply_vouchers_to_order,
    load_applied_vouchers_for_order,
)
from app.utils.auth import get_current_staff, require_role

router = APIRouter(prefix="/vouchers", tags=["vouchers"])


def get_plotholders_client() -> PlotholdersClient:
    return PlotholdersClient()


def _plotholders_http_exception(exc: PlotholdersAPIError) -> HTTPException:
    """Map upstream Plotholders failures to API responses."""
    if exc.status_code is not None and 400 <= exc.status_code < 500:
        detail = exc.response_body or str(exc)
        return HTTPException(status_code=exc.status_code, detail=detail)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Plotholders API is unavailable",
    )


@router.post("/redeem")
async def redeem_voucher(
    payload: dict[str, str],
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> Any:
    """Proxy Plotholders voucher redemption by code.

    Accepts { code, staff_id, outlet } and forwards the request to
    the Plotholders API server-side to avoid CORS issues.
    """
    code = payload.get("code", "").strip()
    staff_id = payload.get("staff_id", "")
    outlet = payload.get("outlet", "")

    if not code:
        raise HTTPException(status_code=422, detail="code is required")
    if not staff_id:
        raise HTTPException(status_code=422, detail="staff_id is required")
    if not outlet:
        raise HTTPException(status_code=422, detail="outlet is required")

    try:
        return await plotholders.redeem_voucher_by_code(code, staff_id, outlet)
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc


@router.post("/validate", response_model=VoucherValidateRead)
async def validate_voucher(
    payload: VoucherValidateRequest,
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> Any:
    """Validate a voucher code via Plotholders (POS calls this; Plotholders is source of truth)."""
    client = plotholders
    try:
        external = await client.get_voucher(payload.code)
    except PlotholdersAPIError as exc:
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voucher not found")

    redeemed = external.get("redeemed_at") or external.get("redeemed") or external.get("is_redeemed")
    if redeemed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Voucher has already been redeemed")

    amount_raw = external.get("amount") or external.get("value") or external.get("discount") or 0
    try:
        amount = float(amount_raw)
    except Exception:
        amount = 0.0

    # Return minimal validate response; id may be code for external
    vid = external.get("id") or payload.code
    vtype = external.get("type") or "acre_group"
    return VoucherValidateRead(
        id=str(vid),
        code=payload.code,
        type=vtype if vtype in ("cdc", "acre_group") else "acre_group",
        amount=amount,
        is_valid=True,
    )


@router.post("/orders/{order_id}/vouchers", response_model=OrderRead)
async def apply_voucher_to_order(
    order_id: UUID,
    payload: VoucherApplyRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
) -> Any:
    """Apply one or more vouchers to a pending order by code.

    Calls Plotholders for validation/redeem then records local OrderVoucher.
    """
    await apply_vouchers_to_order(
        db,
        order_id=order_id,
        codes=payload.codes,
        staff=current_staff,
        plotholders=plotholders,
    )
    order = await load_order_or_404(db, order_id)
    return await _enrich_order_with_vouchers(db, order)


async def _enrich_order_with_vouchers(db: AsyncSession, order: Any) -> OrderRead:
    """Attach applied_vouchers and voucher_discount to an order dict/model for responses."""
    applied = await load_applied_vouchers_for_order(db, order.id)
    voucher_total = sum((av["amount_applied"] for av in applied), 0.0)

    # Build a response-friendly object. FastAPI will serialize the SQLA model + extras.
    # We attach dynamic attributes that the schema will pick up via from_attributes + explicit fields.
    order.applied_vouchers = applied  # type: ignore[attr-defined]
    order.voucher_discount = voucher_total if voucher_total > 0 else None  # type: ignore[attr-defined]
    return order  # type: ignore[return-value]
