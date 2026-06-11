"""Campaign management API routes."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.campaign import Campaign
from app.models.staff import Staff
from app.schemas.campaign import CampaignCreate, CampaignMetricsRead, CampaignRead, CampaignUpdate
from app.services.campaigns import campaign_metrics, list_campaigns, load_campaign_or_404
from app.utils.auth import get_current_staff

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.get("", response_model=list[CampaignRead])
async def list_all_campaigns(
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[Campaign]:
    """List campaigns."""
    return await list_campaigns(db)


@router.post("", response_model=CampaignRead, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Campaign:
    """Create a campaign."""
    campaign = Campaign(**payload.model_dump())
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.get("/{campaign_id}", response_model=CampaignRead)
async def get_campaign(
    campaign_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Campaign:
    """Return one campaign by id."""
    return await load_campaign_or_404(db, campaign_id)


@router.put("/{campaign_id}", response_model=CampaignRead)
async def update_campaign(
    campaign_id: UUID,
    payload: CampaignUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Campaign:
    """Update a campaign."""
    campaign = await load_campaign_or_404(db, campaign_id)
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(campaign, field, value)
    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.get("/{campaign_id}/metrics", response_model=CampaignMetricsRead)
async def get_campaign_metrics(
    campaign_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Any:
    """Return campaign metrics."""
    return await campaign_metrics(db, campaign_id)
