"""Customer management API routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.customer import Customer
from app.models.staff import Staff
from app.schemas.customer import CustomerCreate, CustomerRead, CustomerSignupResponse
from app.services.campaigns import list_customers
from app.services.customers import (
    build_customer_signup_response,
    create_customer_account,
    load_customer_or_404,
)
from app.utils.auth import get_current_staff

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=list[CustomerRead])
async def list_all_customers(
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[Customer]:
    """List customers with signup campaign attribution."""
    return await list_customers(db)


@router.post("", response_model=CustomerSignupResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(
    payload: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> CustomerSignupResponse:
    """Create a customer from the admin UI."""
    customer, _campaign, issued_voucher = await create_customer_account(
        db,
        name=payload.name,
        phone=payload.phone,
        email=payload.email,
        tier=payload.tier,
        moments_total=payload.moments_total,
        campaign_code=payload.campaign_code,
    )
    return build_customer_signup_response(customer, issued_voucher)


@router.post("/signup", response_model=CustomerSignupResponse, status_code=status.HTTP_201_CREATED)
async def signup_customer(
    payload: CustomerCreate,
    db: AsyncSession = Depends(get_db),
) -> CustomerSignupResponse:
    """Public customer signup endpoint with optional campaign code."""
    customer, _campaign, issued_voucher = await create_customer_account(
        db,
        name=payload.name,
        phone=payload.phone,
        email=payload.email,
        tier=payload.tier,
        moments_total=payload.moments_total,
        campaign_code=payload.campaign_code,
    )
    return build_customer_signup_response(customer, issued_voucher)


@router.get("/{customer_id}", response_model=CustomerRead)
async def get_customer(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Customer:
    """Return one customer by id."""
    return await load_customer_or_404(db, customer_id)
