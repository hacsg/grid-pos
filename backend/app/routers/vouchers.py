"""Voucher management and redemption routes."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.campaign import Campaign
from app.models.customer import Customer
from app.models.staff import Staff, StaffRole
from app.models.voucher import Voucher, VoucherType
from app.schemas.order import OrderRead
from app.models.outlet import Outlet
from app.schemas.voucher import (
    GiftCardActivateRead,
    GiftCardActivateRequest,
    VoucherApplyRequest,
    VoucherBulkIssueRequest,
    VoucherBulkIssueResponse,
    VoucherCreate,
    VoucherIssueRequest,
    VoucherRead,
    VoucherValidateRead,
    VoucherValidateRequest,
)
from app.services.campaigns import load_campaign_or_404
from app.services.customers import load_customer_or_404
from app.services.orders import load_order_or_404
from app.services.plotholders_client import PlotholdersAPIError, PlotholdersClient
from app.services.vouchers import (
    _assert_spendable,
    apply_vouchers_to_order,
    create_voucher,
    issue_voucher,
    list_vouchers,
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


def _voucher_read(
    voucher: Voucher,
    *,
    customer: Customer | None = None,
    campaign: Campaign | None = None,
) -> VoucherRead:
    """Build an enriched voucher response with flattened customer/campaign labels."""
    customer = customer or voucher.customer
    campaign = campaign or voucher.campaign
    data = VoucherRead.model_validate(voucher)
    data.customer_name = customer.name if customer else None
    data.customer_phone = customer.phone if customer else None
    data.campaign_name = campaign.name if campaign else None
    data.campaign_code_prefix = campaign.code_prefix if campaign else None
    return data


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


@router.post("/gift-cards/activate", response_model=GiftCardActivateRead)
async def activate_gift_card(
    payload: GiftCardActivateRequest,
    db: AsyncSession = Depends(get_db),
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> Any:
    """Activate a physical gift card after it has been paid for at the till."""
    outlet = await db.get(Outlet, current_staff.outlet_id)
    outlet_name = outlet.name if outlet else str(current_staff.outlet_id)

    try:
        external = await plotholders.activate_gift_card(
            payload.code.strip(),
            str(current_staff.id),
            outlet_name,
        )
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc

    code = str(external.get("code") or payload.code)
    amount_raw = external.get("amount") or external.get("value") or external.get("discount") or 0
    try:
        amount = float(amount_raw)
    except Exception:
        amount = 0.0
    status_val = str(external.get("status") or "active")
    expires_at = external.get("expires_at")

    return GiftCardActivateRead(
        code=code,
        amount=amount,
        status=status_val,
        expires_at=expires_at,
    )


@router.post("", response_model=VoucherRead, status_code=status.HTTP_201_CREATED)
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


@router.post("/issue", response_model=VoucherRead, status_code=status.HTTP_201_CREATED)
async def issue_existing_customer_voucher(
    payload: VoucherIssueRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> VoucherRead:
    """Issue one campaign voucher to an existing customer."""
    campaign = await load_campaign_or_404(db, payload.campaign_id)
    customer = await load_customer_or_404(db, payload.customer_id)
    discount_cents = payload.discount_cents if payload.discount_cents is not None else campaign.discount_cents
    voucher = await issue_voucher(
        db,
        customer_id=customer.id,
        campaign_id=campaign.id,
        code_prefix=campaign.code_prefix,
        discount_cents=discount_cents,
    )
    return _voucher_read(voucher, customer=customer, campaign=campaign)


@router.post("/bulk-issue", response_model=VoucherBulkIssueResponse, status_code=status.HTTP_201_CREATED)
async def bulk_issue_campaign_vouchers(
    payload: VoucherBulkIssueRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> VoucherBulkIssueResponse:
    """Issue campaign vouchers to selected customers or all campaign signups."""
    campaign = await load_campaign_or_404(db, payload.campaign_id)
    discount_cents = payload.discount_cents if payload.discount_cents is not None else campaign.discount_cents

    if payload.customer_ids is None:
        result = await db.execute(
            select(Customer).where(Customer.signup_campaign_id == campaign.id).order_by(Customer.name.asc())
        )
        customers = list(result.scalars().all())
    else:
        customer_ids = list(dict.fromkeys(payload.customer_ids))
        if not customer_ids:
            return VoucherBulkIssueResponse(issued=0, codes=[])
        result = await db.execute(select(Customer).where(Customer.id.in_(customer_ids)))
        customers_by_id = {customer.id: customer for customer in result.scalars().all()}
        missing_ids = [str(customer_id) for customer_id in customer_ids if customer_id not in customers_by_id]
        if missing_ids:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customers not found: {', '.join(missing_ids)}",
            )
        customers = [customers_by_id[customer_id] for customer_id in customer_ids]

    codes: list[str] = []
    for customer in customers:
        voucher = await issue_voucher(
            db,
            customer_id=customer.id,
            campaign_id=campaign.id,
            code_prefix=campaign.code_prefix,
            discount_cents=discount_cents,
            commit=False,
        )
        codes.append(voucher.code)

    await db.commit()
    return VoucherBulkIssueResponse(issued=len(codes), codes=codes)


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

    _assert_spendable(external, payload.code)

    amount_raw = external.get("amount") or external.get("value") or external.get("discount") or 0
    try:
        amount = float(amount_raw)
    except Exception:
        amount = 0.0

    # Return minimal validate response; id may be code for external
    vid = external.get("id") or payload.code
    vtype = external.get("type") or "acre_group"
    source = external.get("source")
    source_str = str(source) if source is not None else None
    kind = external.get("kind")
    kind_str = str(kind) if kind is not None else None
    status_raw = external.get("status")
    status_str = str(status_raw) if status_raw is not None else None
    return VoucherValidateRead(
        id=str(vid),
        code=payload.code,
        type=vtype if vtype in ("cdc", "acre_group") else "acre_group",
        amount=amount,
        is_valid=True,
        kind=kind_str,
        source=source_str,
        status=status_str,
        is_gift_card=source_str == "gift",
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


@router.get("", response_model=list[VoucherRead])
async def list_all_vouchers(
    type: VoucherType | None = None,
    redeemed: bool | None = Query(default=None, description="true=redeemed, false=available"),
    campaign_id: UUID | None = None,
    outlet_id: UUID | None = None,
    order_id: UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[VoucherRead]:
    """List vouchers (admin and staff). Supports basic filters."""
    vouchers = await list_vouchers(
        db,
        type=type,
        redeemed=redeemed,
        campaign_id=campaign_id,
        outlet_id=outlet_id,
        order_id=order_id,
        limit=limit,
        offset=offset,
    )
    return [_voucher_read(voucher) for voucher in vouchers]


async def _enrich_order_with_vouchers(db: AsyncSession, order: Any) -> OrderRead:
    """Attach applied_vouchers and voucher_discount to an order dict/model for responses."""
    applied = await load_applied_vouchers_for_order(db, order.id)
    voucher_total = sum((av["amount_applied"] for av in applied), 0.0)

    # Build a response-friendly object. FastAPI will serialize the SQLA model + extras.
    # We attach dynamic attributes that the schema will pick up via from_attributes + explicit fields.
    order.applied_vouchers = applied  # type: ignore[attr-defined]
    order.voucher_discount = voucher_total if voucher_total > 0 else None  # type: ignore[attr-defined]
    return order  # type: ignore[return-value]
