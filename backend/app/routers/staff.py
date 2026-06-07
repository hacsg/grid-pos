"""Staff authentication and management API routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.outlet import Outlet
from app.models.staff import Staff
from app.schemas.staff import StaffCreate, StaffLogin, StaffRead, StaffUpdate, TokenRead
from app.utils.auth import create_access_token
from app.utils.hashing import hash_pin, verify_pin

router = APIRouter(prefix="/staff", tags=["staff"])


async def _load_staff_or_404(db: AsyncSession, staff_id: UUID) -> Staff:
    """Load a staff member by id or raise a 404 response."""
    staff = await db.get(Staff, staff_id)
    if staff is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found")
    return staff


async def _ensure_outlet_exists(db: AsyncSession, outlet_id: UUID) -> None:
    """Validate that an outlet exists."""
    if await db.get(Outlet, outlet_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outlet not found")


@router.post("", response_model=StaffRead, status_code=status.HTTP_201_CREATED)
async def create_staff(payload: StaffCreate, db: AsyncSession = Depends(get_db)) -> Staff:
    """Create a staff member with a hashed PIN."""
    await _ensure_outlet_exists(db, payload.outlet_id)
    staff = Staff(
        name=payload.name,
        role=payload.role,
        outlet_id=payload.outlet_id,
        is_active=payload.is_active,
        pin_hash=hash_pin(payload.pin),
    )
    db.add(staff)
    await db.commit()
    await db.refresh(staff)
    return staff


@router.post("/login", response_model=TokenRead)
async def login_staff(payload: StaffLogin, db: AsyncSession = Depends(get_db)) -> TokenRead:
    """Authenticate a staff member by outlet, name, and PIN."""
    result = await db.execute(
        select(Staff).where(
            Staff.outlet_id == payload.outlet_id,
            Staff.name == payload.name,
            Staff.is_active.is_(True),
        )
    )
    staff = result.scalar_one_or_none()
    if staff is None or not verify_pin(payload.pin, staff.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid staff credentials",
        )
    return TokenRead(access_token=create_access_token(staff.id), staff=staff)


@router.get("", response_model=list[StaffRead])
async def list_staff(
    outlet_id: UUID | None = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
) -> list[Staff]:
    """List staff, optionally scoped to an outlet."""
    statement = select(Staff)
    if outlet_id is not None:
        statement = statement.where(Staff.outlet_id == outlet_id)
    if active_only:
        statement = statement.where(Staff.is_active.is_(True))
    statement = statement.order_by(Staff.name)
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/{staff_id}", response_model=StaffRead)
async def get_staff(staff_id: UUID, db: AsyncSession = Depends(get_db)) -> Staff:
    """Return one staff member by id."""
    return await _load_staff_or_404(db, staff_id)


@router.patch("/{staff_id}", response_model=StaffRead)
async def update_staff(
    staff_id: UUID,
    payload: StaffUpdate,
    db: AsyncSession = Depends(get_db),
) -> Staff:
    """Update staff profile, role, outlet, active state, or PIN."""
    staff = await _load_staff_or_404(db, staff_id)
    update_data = payload.model_dump(exclude_unset=True)
    if "outlet_id" in update_data:
        await _ensure_outlet_exists(db, update_data["outlet_id"])
    if "pin" in update_data:
        staff.pin_hash = hash_pin(update_data.pop("pin"))
    for field, value in update_data.items():
        setattr(staff, field, value)
    await db.commit()
    await db.refresh(staff)
    return staff


@router.delete("/{staff_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_staff(staff_id: UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Deactivate a staff member instead of deleting their order history."""
    staff = await _load_staff_or_404(db, staff_id)
    staff.is_active = False
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

