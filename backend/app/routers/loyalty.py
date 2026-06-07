"""Loyalty management API routes."""

from fastapi import APIRouter, Depends
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

router = APIRouter(prefix="/loyalty", tags=["loyalty"])


@router.post("/lookup", response_model=LoyaltyMemberProfile)
async def lookup_member(
    payload: LoyaltyLookupRequest,
    db: AsyncSession = Depends(get_db),
) -> LoyaltyMemberProfile:
    """Look up a loyalty member by phone number.

    Returns member profile with points balance and tier.
    Returns 404 with `signup_available: true` if not found.
    """
    return await LoyaltyService.lookup_member(db, phone=payload.phone)


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


@router.post("/signup", response_model=LoyaltySignupResponse, status_code=201)
async def signup_member(
    payload: LoyaltySignupRequest,
    db: AsyncSession = Depends(get_db),
) -> LoyaltySignupResponse:
    """Create a new loyalty program member.

    Returns basic profile with zero points and bronze tier.
    """
    return await LoyaltyService.signup(
        db,
        name=payload.name,
        phone=payload.phone,
    )