"""Loyalty management API routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.staff import Staff
from app.services.plotholders_client import PlotholdersAPIError, PlotholdersClient
from app.utils.auth import get_current_staff
from app.utils.phone import normalize_sg_phone, validate_sg_phone_or_raise

router = APIRouter(prefix="/loyalty", tags=["loyalty"])


def get_plotholders_client() -> PlotholdersClient:
    """Build a Plotholders client for request handlers."""
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


@router.get("/lookup")
async def lookup_plotholders_customer(
    phone: str | None = Query(default=None, min_length=1),
    referral_code: str | None = Query(default=None, min_length=1),
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> dict[str, Any]:
    """Proxy Plotholders customer lookup by phone or referral code.

    When phone is provided, it is validated as a Singapore number and normalized
    to E.164 format before forwarding to Plotholders.
    """
    if bool(phone) == bool(referral_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of phone or referral_code",
        )

    if phone is not None:
        try:
            validate_sg_phone_or_raise(phone)
            phone = normalize_sg_phone(phone)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    try:
        customer = (
            await plotholders.lookup_by_phone(phone)
            if phone is not None
            else await plotholders.lookup_by_referral_code(referral_code or "")
        )
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc

    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "Customer not found", "signup_available": True},
        )
    return customer


@router.post("/lookup")
async def lookup_member(
    payload: dict[str, Any],
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> dict[str, Any]:
    """Look up a loyalty member by phone number (proxied to Plotholders).

    Phone is validated as a Singapore number and normalized to E.164 before lookup.
    Returns member profile (adapted for POS compatibility).
    Returns 404 with `signup_available: true` if not found.
    """
    phone = payload.get("phone") if isinstance(payload, dict) else None
    country_code = payload.get("country_code") if isinstance(payload, dict) else None
    try:
        validate_sg_phone_or_raise(phone or "")
        normalized = normalize_sg_phone(phone or "", country_code)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    try:
        customer = await plotholders.lookup_by_phone(normalized)
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc

    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "Customer not found", "signup_available": True},
        )

    # Adapt Plotholders customer shape to what POS web expects (LoyaltyMember)
    moments = customer.get("moments_total") or customer.get("points") or customer.get("lifetime_moments") or 0
    member_id = customer.get("id") or customer.get("member_id") or customer.get("customer_id")
    return {
        "member_id": member_id,
        "customer_id": customer.get("id") or customer.get("customer_id") or member_id,
        "name": customer.get("name") or "",
        "phone": customer.get("phone") or normalized,
        "points": int(moments) if isinstance(moments, (int, float)) else 0,
        "points_value": float(moments) / 100.0 if moments else 0.0,
        "tier": customer.get("tier") or "bronze",
        "lifetime_moments": moments,
        "rewards": customer.get("rewards") or customer.get("available_rewards") or [],
        "vouchers": customer.get("vouchers") or [],
    }


@router.post("/earn")
async def earn_points(
    payload: dict[str, Any],
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> dict[str, Any]:
    """Record a purchase moment via Plotholders (replaces local points earn)."""
    customer_id = None
    order_total = 0.0
    outlet = ""
    if isinstance(payload, dict):
        customer_id = payload.get("member_id") or payload.get("customer_id")
        order_total = float(payload.get("amount_spent") or payload.get("order_total") or 0)
        outlet = payload.get("outlet") or ""
    try:
        return await plotholders.record_purchase(
            customer_id=str(customer_id or ""),
            order_total=order_total,
            outlet=outlet,
        )
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc


@router.post("/redeem")
async def redeem_points(
    payload: dict[str, Any],
    current_staff: Staff = Depends(get_current_staff),
) -> dict[str, Any]:
    """Stub for points redeem (Plotholders uses moments; discount already applied client-side).
    Returns a compatible response so POS terminal flow is not broken.
    """
    points = 0
    if isinstance(payload, dict):
        points = int(payload.get("points_to_redeem") or payload.get("points") or 0)
    discount = points / 100.0
    return {
        "points_redeemed": points,
        "discount_amount": discount,
        "remaining_balance": 0,
        "new_points": 0,
    }


@router.post("/signup", status_code=201)
async def signup_member(
    payload: dict[str, Any],
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> dict[str, Any]:
    """Create a new loyalty program member (proxied to Plotholders).

    Phone is validated as a Singapore number and normalized to E.164 before creation.
    """
    phone = payload.get("phone") if isinstance(payload, dict) else None
    country_code = payload.get("country_code") if isinstance(payload, dict) else None
    name = payload.get("name") if isinstance(payload, dict) else None
    campaign_code = payload.get("campaign_code") if isinstance(payload, dict) else None
    email = payload.get("email") if isinstance(payload, dict) else None
    birthday = payload.get("birthday") if isinstance(payload, dict) else None
    referred_by_code = payload.get("referred_by_code") if isinstance(payload, dict) else None

    try:
        validate_sg_phone_or_raise(phone or "")
        normalized_phone = normalize_sg_phone(phone or "", country_code)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    try:
        return await plotholders.create_customer(
            phone=normalized_phone,
            email=email,
            name=name,
            birthday=birthday,
            referred_by_code=referred_by_code,
            campaign_code=campaign_code,
        )
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc


@router.post("/redeem-voucher/{voucher_id}")
async def redeem_voucher(
    voucher_id: str,
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> dict[str, Any]:
    """Proxy Plotholders voucher redemption."""
    try:
        return await plotholders.redeem_voucher(voucher_id)
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc


@router.post("/redeem-reward/{reward_id}")
async def redeem_reward(
    reward_id: str,
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
    current_staff: Staff = Depends(get_current_staff),
) -> dict[str, Any]:
    """Proxy Plotholders reward redemption."""
    try:
        return await plotholders.redeem_reward(reward_id)
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc
