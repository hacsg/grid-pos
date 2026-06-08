"""Loyalty management API routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.loyalty import (
    LoyaltyEarnRequest,
    LoyaltyEarnResponse,
    LoyaltyLookupNotFound,
    LoyaltyLookupRequest,
    LoyaltyMemberProfile,
    LoyaltyRedeemRequest,
    LoyaltyRedeemResponse,
    LoyaltySignupRequest,
    LoyaltySignupResponse,
)
from app.services.loyalty import LoyaltyService
from app.services.plotholders_client import PlotholdersAPIError, PlotholdersClient
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


@router.post("/lookup", response_model=LoyaltyMemberProfile)
async def lookup_member(
    payload: LoyaltyLookupRequest,
    db: AsyncSession = Depends(get_db),
) -> LoyaltyMemberProfile:
    """Look up a loyalty member by phone number.

    Phone is validated as a Singapore number and normalized to E.164 before lookup.
    Returns member profile with points balance and tier.
    Returns 404 with `signup_available: true` if not found.
    """
    try:
        validate_sg_phone_or_raise(payload.phone)
        normalized = normalize_sg_phone(payload.phone, payload.country_code)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    # Pass the normalized phone; service will also validate/normalize defensively
    profile = await LoyaltyService.lookup_member(db, phone=normalized, country_code=payload.country_code)
    return profile


@router.post("/earn", response_model=LoyaltyEarnResponse)
async def earn_points(
    payload: LoyaltyEarnRequest,
    db: AsyncSession = Depends(get_db),
) -> LoyaltyEarnResponse:
    """Award loyalty points after payment.

    S$1 spent = 10 points earned.
    """
    return await LoyaltyService.earn_points(
        db,
        member_id=payload.member_id,
        order_id=payload.order_id,
        amount_spent=payload.amount_spent,
    )


@router.post("/redeem", response_model=LoyaltyRedeemResponse)
async def redeem_points(
    payload: LoyaltyRedeemRequest,
    db: AsyncSession = Depends(get_db),
) -> LoyaltyRedeemResponse:
    """Redeem loyalty points for a discount before payment.

    Minimum redemption: 100 points (S$1.00).
    Cannot redeem more than available balance.
    """
    return await LoyaltyService.redeem_points(
        db,
        member_id=payload.member_id,
        order_id=payload.order_id,
        points_to_redeem=payload.points_to_redeem,
    )


@router.post("/signup", status_code=201)
async def signup_member(
    payload: LoyaltySignupRequest,
    db: AsyncSession = Depends(get_db),
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
) -> dict[str, Any] | LoyaltySignupResponse:
    """Create a new loyalty program member.

    Phone is validated as a Singapore number and normalized to E.164 before creation.
    Returns basic profile with zero points and bronze tier.
    """
    try:
        validate_sg_phone_or_raise(payload.phone)
        normalized_phone = normalize_sg_phone(payload.phone, payload.country_code)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    uses_plotholders_payload = any(
        value is not None
        for value in (payload.email, payload.birthday, payload.referred_by_code)
    )
    if uses_plotholders_payload or payload.name is None:
        try:
            return await plotholders.create_customer(
                phone=normalized_phone,
                email=payload.email,
                name=payload.name,
                birthday=payload.birthday,
                referred_by_code=payload.referred_by_code,
            )
        except PlotholdersAPIError as exc:
            raise _plotholders_http_exception(exc) from exc

    return await LoyaltyService.signup(
        db,
        name=payload.name,
        phone=normalized_phone,
        country_code=payload.country_code,
    )


@router.post("/redeem-voucher/{voucher_id}")
async def redeem_voucher(
    voucher_id: str,
    plotholders: PlotholdersClient = Depends(get_plotholders_client),
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
) -> dict[str, Any]:
    """Proxy Plotholders reward redemption."""
    try:
        return await plotholders.redeem_reward(reward_id)
    except PlotholdersAPIError as exc:
        raise _plotholders_http_exception(exc) from exc
