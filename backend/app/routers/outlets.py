"""Outlet management API routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.outlet import Outlet
from app.schemas.outlet import OutletCreate, OutletRead, OutletUpdate

router = APIRouter(prefix="/outlets", tags=["outlets"])


async def load_outlet_or_404(db: AsyncSession, outlet_id: UUID) -> Outlet:
    """Load an outlet by id or raise a 404 response."""
    outlet = await db.get(Outlet, outlet_id)
    if outlet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outlet not found")
    return outlet


@router.post("", response_model=OutletRead, status_code=status.HTTP_201_CREATED)
async def create_outlet(payload: OutletCreate, db: AsyncSession = Depends(get_db)) -> Outlet:
    """Create a new outlet."""
    outlet = Outlet(**payload.model_dump())
    db.add(outlet)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Outlet name already exists",
        ) from exc
    await db.refresh(outlet)
    return outlet


@router.get("", response_model=list[OutletRead])
async def list_outlets(db: AsyncSession = Depends(get_db)) -> list[Outlet]:
    """List all outlets ordered by name."""
    result = await db.execute(select(Outlet).order_by(Outlet.name))
    return list(result.scalars().all())


@router.get("/{outlet_id}", response_model=OutletRead)
async def get_outlet(outlet_id: UUID, db: AsyncSession = Depends(get_db)) -> Outlet:
    """Return one outlet by id."""
    return await load_outlet_or_404(db, outlet_id)


@router.patch("/{outlet_id}", response_model=OutletRead)
async def update_outlet(
    outlet_id: UUID,
    payload: OutletUpdate,
    db: AsyncSession = Depends(get_db),
) -> Outlet:
    """Update an outlet."""
    outlet = await load_outlet_or_404(db, outlet_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(outlet, field, value)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Outlet name already exists",
        ) from exc
    await db.refresh(outlet)
    return outlet


@router.delete("/{outlet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_outlet(outlet_id: UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Delete an outlet."""
    outlet = await load_outlet_or_404(db, outlet_id)
    await db.delete(outlet)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

