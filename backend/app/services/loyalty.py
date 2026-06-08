"""Loyalty service — member management, earning, and redeeming.

Currently uses in-memory storage via the database (LoyaltyMember model).
Structure is designed so that swapping to the real Haven API requires only
changing the internal implementation of this class; the router layer is
unaffected.
"""

from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.loyalty import LoyaltyMember
from app.models.order import Order
from app.schemas.loyalty import (
    LoyaltyEarnResponse,
    LoyaltyMemberProfile,
    LoyaltyRedeemResponse,
    LoyaltySignupResponse,
)
from app.utils.phone import normalize_sg_phone, validate_sg_phone_or_raise

# Exchange rate: S$1 spent = 10 points
POINTS_PER_DOLLAR = 10
# 100 points = S$1.00
POINTS_VALUE_DIVISOR = 100
# Minimum points redeemable
MINIMUM_REDEMPTION = 100
# Two-decimal rounding
CENT = Decimal("0.01")


def _compute_tier(points: int) -> str:
    """Determine tier based on points balance."""
    if points >= 5000:
        return "platinum"
    if points >= 2000:
        return "gold"
    if points >= 500:
        return "silver"
    return "bronze"


def _compute_points_value(points: int) -> Decimal:
    """Convert points to monetary value, rounded to 2 decimal places."""
    return (Decimal(str(points)) / Decimal(str(POINTS_VALUE_DIVISOR))).quantize(CENT, rounding=ROUND_HALF_UP)


class LoyaltyService:
    """Loyalty program operations.

    Each method is a static async function that accepts a DB session
    and the request payload. This makes it easy to swap the backend
    (e.g. replace with HTTP calls to Haven API) without changing
    the router signatures.
    """

    @staticmethod
    async def lookup_member(db: AsyncSession, phone: str, country_code: str = "+65") -> LoyaltyMemberProfile:
        """Look up a loyalty member by phone number.

        Validates and normalizes the phone to E.164 SG format before querying.
        Raises HTTPException 404 if not found.
        """
        validate_sg_phone_or_raise(phone)
        normalized_phone = normalize_sg_phone(phone, country_code)

        result = await db.execute(
            select(LoyaltyMember).where(LoyaltyMember.phone == normalized_phone)
        )
        member = result.scalar_one_or_none()
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "detail": "Member not found",
                    "signup_available": True,
                },
            )
        return LoyaltyMemberProfile(
            member_id=member.id,
            name=member.name,
            phone=member.phone,
            country_code=member.country_code,
            points=member.points,
            points_value=_compute_points_value(member.points),
            tier=member.tier,
        )

    @staticmethod
    async def earn_points(
        db: AsyncSession,
        member_id: UUID,
        order_id: UUID,
        amount_spent: Decimal,
    ) -> LoyaltyEarnResponse:
        """Award points based on the amount spent.

        S$1 spent = 10 points earned.
        """
        member = await db.get(LoyaltyMember, member_id)
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Loyalty member not found",
            )

        points_earned = int(amount_spent * POINTS_PER_DOLLAR)
        member.points += points_earned
        member.total_spent += amount_spent
        member.tier = _compute_tier(member.points)

        # Record earned points on the order
        order = await db.get(Order, order_id)
        if order is not None:
            order.loyalty_points_earned = points_earned

        await db.commit()

        return LoyaltyEarnResponse(
            points_earned=points_earned,
            new_balance=member.points,
            tier=member.tier,
        )

    @staticmethod
    async def redeem_points(
        db: AsyncSession,
        member_id: UUID,
        order_id: UUID,
        points_to_redeem: int,
    ) -> LoyaltyRedeemResponse:
        """Redeem loyalty points for a discount on an order.

        Validates:
        - points_to_redeem >= MINIMUM_REDEMPTION (100)
        - points_to_redeem <= member's current balance
        """
        member = await db.get(LoyaltyMember, member_id)
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Loyalty member not found",
            )

        if points_to_redeem < MINIMUM_REDEMPTION:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Minimum redemption is {MINIMUM_REDEMPTION} points",
            )

        if points_to_redeem > member.points:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient points — cannot redeem more than available balance",
            )

        discount_amount = _compute_points_value(points_to_redeem)
        remaining_points = member.points - points_to_redeem
        member.points = remaining_points
        member.tier = _compute_tier(member.points)
        await db.commit()

        return LoyaltyRedeemResponse(
            points_redeemed=points_to_redeem,
            discount_amount=discount_amount,
            remaining_balance=remaining_points,
            new_points=remaining_points,
        )

    @staticmethod
    async def signup(
        db: AsyncSession,
        name: str,
        phone: str,
        country_code: str = "+65",
    ) -> LoyaltySignupResponse:
        """Create a new loyalty member."""
        validate_sg_phone_or_raise(phone)
        normalized_phone = normalize_sg_phone(phone, country_code)

        # Check for duplicate phone (using normalized E.164 form)
        result = await db.execute(
            select(LoyaltyMember).where(LoyaltyMember.phone == normalized_phone)
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A member with this phone number already exists",
            )

        member = LoyaltyMember(
            name=name,
            phone=normalized_phone,
            country_code=country_code,
            points=0,
            tier="bronze",
            total_spent=Decimal("0.00"),
        )
        db.add(member)
        await db.commit()
        await db.refresh(member)

        return LoyaltySignupResponse(
            member_id=member.id,
            name=member.name,
            phone=member.phone,
            country_code=member.country_code,
            points=member.points,
            tier=member.tier,
        )
