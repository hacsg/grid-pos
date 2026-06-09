"""Campaign business logic and metrics."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.campaign import Campaign
from app.models.customer import Customer
from app.models.order import Order, OrderStatus
from app.models.voucher import Voucher
from app.schemas.campaign import CampaignMetricsRead


async def load_campaign_or_404(db: AsyncSession, campaign_id: UUID) -> Campaign:
    """Load a campaign or raise 404."""
    campaign = await db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    return campaign


async def list_campaigns(db: AsyncSession) -> list[Campaign]:
    """Return campaigns ordered for admin display."""
    result = await db.execute(select(Campaign).order_by(Campaign.name.asc()))
    return list(result.scalars().all())


async def list_customers(db: AsyncSession) -> list[Customer]:
    """Return customers with signup campaign info."""
    result = await db.execute(
        select(Customer).options(selectinload(Customer.signup_campaign)).order_by(Customer.name.asc())
    )
    return list(result.scalars().all())


async def campaign_metrics(db: AsyncSession, campaign_id: UUID) -> CampaignMetricsRead:
    """Return signup attribution and conversion stats for a campaign."""
    campaign = await load_campaign_or_404(db, campaign_id)

    total_signups_result = await db.execute(
        select(func.count(Customer.id)).where(Customer.signup_campaign_id == campaign_id)
    )
    total_signups = int(total_signups_result.scalar_one() or 0)

    vouchers_result = await db.execute(
        select(func.count(Voucher.id)).where(
            Voucher.campaign_id == campaign_id,
            Voucher.customer_id.is_not(None),
        )
    )
    vouchers_auto_issued = int(vouchers_result.scalar_one() or 0)

    conversion_result = await db.execute(
        select(func.count(func.distinct(Customer.id)))
        .join(Order, cast(Customer.id, String) == Order.customer_id)
        .where(
            Customer.signup_campaign_id == campaign_id,
            Order.status == OrderStatus.paid,
        )
    )
    converted = int(conversion_result.scalar_one() or 0)

    if converted == 0:
        redeemed_result = await db.execute(
            select(func.count(func.distinct(Voucher.customer_id))).where(
                Voucher.campaign_id == campaign_id,
                Voucher.customer_id.is_not(None),
                Voucher.redeemed_at.is_not(None),
            )
        )
        converted = int(redeemed_result.scalar_one() or 0)

    conversion_rate = round((converted / total_signups) * 100, 2) if total_signups else 0.0
    return CampaignMetricsRead(
        campaign_id=campaign.id,
        campaign_name=campaign.name,
        total_signups=total_signups,
        vouchers_auto_issued=vouchers_auto_issued,
        signup_purchase_conversions=converted,
        signup_purchase_conversion_rate=conversion_rate,
    )
