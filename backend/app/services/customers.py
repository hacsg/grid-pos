"""Customer signup and campaign attribution services."""

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.campaign import Campaign
from app.models.customer import Customer
from app.models.voucher import Voucher
from app.schemas.customer import CustomerSignupResponse, IssuedVoucherSummary
from app.services.vouchers import issue_voucher
from app.utils.phone import normalize_sg_phone, validate_sg_phone_or_raise


def _effective_signup_discount_cents(campaign: Campaign) -> int:
    """Return the campaign-specific signup voucher amount in cents."""
    if campaign.signup_voucher_discount_cents is not None:
        return campaign.signup_voucher_discount_cents
    return campaign.discount_cents


async def find_campaign_by_code(db: AsyncSession, campaign_code: str | None) -> Campaign | None:
    """Find a campaign whose code_prefix matches the supplied signup code."""
    if campaign_code is None:
        return None

    normalized = campaign_code.strip()
    if not normalized:
        return None

    result = await db.execute(select(Campaign).order_by(func.length(Campaign.code_prefix).desc()))
    campaigns = list(result.scalars().all())
    lowered = normalized.lower()
    for campaign in campaigns:
        prefix = campaign.code_prefix.strip()
        if prefix and lowered.startswith(prefix.lower()):
            return campaign
    return None


async def create_customer_account(
    db: AsyncSession,
    *,
    name: str | None,
    phone: str,
    email: str | None = None,
    tier: str = "bronze",
    moments_total: int = 0,
    campaign_code: str | None = None,
    commit: bool = True,
) -> tuple[Customer, Campaign | None, Voucher | None]:
    """Create a customer, apply signup attribution, and optionally issue a voucher."""
    validate_sg_phone_or_raise(phone)
    normalized_phone = normalize_sg_phone(phone)

    existing = await db.execute(select(Customer).where(Customer.phone == normalized_phone))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A customer with this phone number already exists",
        )

    campaign = await find_campaign_by_code(db, campaign_code)
    if campaign_code and campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign not found for code",
        )

    customer = Customer(
        name=name,
        phone=normalized_phone,
        email=email,
        tier=tier,
        moments_total=moments_total,
        signup_campaign_id=campaign.id if campaign else None,
    )
    db.add(customer)
    await db.flush()

    issued_voucher: Voucher | None = None
    if campaign and campaign.auto_issue_on_signup:
        discount_cents = _effective_signup_discount_cents(campaign)
        if discount_cents > 0:
            issued_voucher = await issue_voucher(
                db,
                customer_id=customer.id,
                campaign_id=campaign.id,
                code_prefix=campaign.code_prefix,
                discount_cents=discount_cents,
                commit=False,
            )

    if commit:
        await db.commit()
        await db.refresh(customer, attribute_names=["signup_campaign"])
        if issued_voucher is not None:
            await db.refresh(issued_voucher)

    return customer, campaign, issued_voucher


async def load_customer_or_404(db: AsyncSession, customer_id) -> Customer:
    """Load a customer with campaign info or raise 404."""
    result = await db.execute(
        select(Customer, func.count(Voucher.id).label("voucher_count"))
        .outerjoin(Voucher, Voucher.customer_id == Customer.id)
        .options(selectinload(Customer.signup_campaign))
        .where(Customer.id == customer_id)
        .group_by(Customer.id)
    )
    row = result.one_or_none()
    customer = row[0] if row else None
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    customer.voucher_count = int(row.voucher_count or 0)  # type: ignore[attr-defined, union-attr]
    return customer


def build_customer_signup_response(
    customer: Customer,
    issued_voucher: Voucher | None = None,
) -> CustomerSignupResponse:
    """Build a signup response from ORM objects."""
    voucher_summary = None
    if issued_voucher is not None:
        voucher_summary = IssuedVoucherSummary(
            id=issued_voucher.id,
            code=issued_voucher.code,
            discount_cents=issued_voucher.discount_cents,
            status=issued_voucher.status,
            campaign_id=issued_voucher.campaign_id,
            customer_id=issued_voucher.customer_id,
        )

    return CustomerSignupResponse(
        id=customer.id,
        name=customer.name,
        phone=customer.phone,
        email=customer.email,
        tier=customer.tier,
        moments_total=customer.moments_total,
        signup_campaign_id=customer.signup_campaign_id,
        signup_campaign=customer.signup_campaign,
        voucher_count=getattr(customer, "voucher_count", 0),
        auto_issued_voucher=voucher_summary,
    )
