"""Voucher management and redemption routes."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.staff import Staff, StaffRole
from app.models.voucher import VoucherType
from app.schemas.order import OrderRead
from app.schemas.voucher import (
    OrderVoucherRead,
    VoucherApplyRequest,
    VoucherCreate,
    VoucherListParams,
    VoucherRead,
    VoucherValidateRead,
    VoucherValidateRequest,
)
from app.services.orders import load_order_or_404
from app.services.plotholders_client import PlotholdersAPIError, PlotholdersClient
from app.services.vouchers import (
    apply_vouchers_to_order,
    create_voucher,
    list_vouchers,
    load_applied_vouchers_for_order,
    validate_voucher_code,
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


@router.post("", response_model=VoucherRead, status_code=201)
async def create_new_voucher(
    payload: VoucherCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager)),
) -> Any:
    """Create a voucher (admin/manager use, primarily for seeding CDC vouchers)."""
    voucher = await create_voucher(
        db,
        code=payload.code,
        type=payload.type,
        amount=payload.amount,
    )
    return voucher


@router.post("/validate", response_model=VoucherValidateRead)
async def validate_voucher(
    payload: VoucherValidateRequest,
    db: AsyncSession = Depends(get_db),
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> Any:
    """Validate a voucher code. Returns details if the voucher is available (not yet redeemed)."""
    voucher = await validate_voucher_code(db, payload.code, plotholders)
    return VoucherValidateRead(
        id=voucher.id,
        code=voucher.code,
        type=voucher.type,
        amount=voucher.amount,
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

    Marks vouchers as redeemed, records order_vouchers links, and reduces the order total.
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


@router.get("", response_model=list[VoucherRead])
async def list_all_vouchers(
    type: VoucherType | None = None,
    redeemed: bool | None = Query(default=None, description="true=redeemed, false=available"),
    outlet_id: UUID | None = None,
    order_id: UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Any:
    """List vouchers (admin and staff). Supports basic filters."""
    vouchers = await list_vouchers(
        db,
        type=type,
        redeemed=redeemed,
        outlet_id=outlet_id,
        order_id=order_id,
        limit=limit,
        offset=offset,
    )
    return vouchers


async def _enrich_order_with_vouchers(db: AsyncSession, order: Any) -> OrderRead:
    """Attach applied_vouchers and voucher_discount to an order dict/model for responses."""
    applied = await load_applied_vouchers_for_order(db, order.id)
    voucher_total = sum((av["amount_applied"] for av in applied), 0.0)

    # Build a response-friendly object. FastAPI will serialize the SQLA model + extras.
    # We attach dynamic attributes that the schema will pick up via from_attributes + explicit fields.
    order.applied_vouchers = applied  # type: ignore[attr-defined]
    order.voucher_discount = voucher_total if voucher_total > 0 else None  # type: ignore[attr-defined]
    return order  # type: ignore[return-value]
