"""Outlet management API routes."""

import base64
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.outlet import Outlet
from app.schemas.outlet import OutletCreate, OutletRead, OutletUpdate, PayNowQrRead

router = APIRouter(prefix="/outlets", tags=["outlets"])

PAYNOW_QR_MAX_BYTES = 500 * 1024
PAYNOW_QR_CONTENT_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
}


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


@router.get("/{outlet_id}/paynow-qr", response_model=PayNowQrRead)
async def get_paynow_qr(outlet_id: UUID, db: AsyncSession = Depends(get_db)) -> PayNowQrRead:
    """Return the current manual PayNow QR for customer display."""
    outlet = await load_outlet_or_404(db, outlet_id)
    return PayNowQrRead(outlet_id=outlet.id, paynow_qr_url=outlet.paynow_qr_url)


@router.put("/{outlet_id}/paynow-qr", response_model=PayNowQrRead)
async def upload_paynow_qr(
    outlet_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> PayNowQrRead:
    """Upload or replace the manual PayNow QR code for an outlet."""
    outlet = await load_outlet_or_404(db, outlet_id)
    content_type = (file.content_type or "").lower()
    image_type = PAYNOW_QR_CONTENT_TYPES.get(content_type)
    if image_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PayNow QR must be a PNG or JPG image",
        )

    content = await file.read(PAYNOW_QR_MAX_BYTES + 1)
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PayNow QR image is empty")
    if len(content) > PAYNOW_QR_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="PayNow QR image must be 500KB or smaller",
        )

    encoded = base64.b64encode(content).decode("ascii")
    outlet.paynow_qr_url = f"data:image/{image_type};base64,{encoded}"
    await db.commit()
    await db.refresh(outlet)
    return PayNowQrRead(outlet_id=outlet.id, paynow_qr_url=outlet.paynow_qr_url)


@router.delete("/{outlet_id}/paynow-qr", response_model=PayNowQrRead)
async def delete_paynow_qr(outlet_id: UUID, db: AsyncSession = Depends(get_db)) -> PayNowQrRead:
    """Remove the manual PayNow QR code for an outlet."""
    outlet = await load_outlet_or_404(db, outlet_id)
    outlet.paynow_qr_url = None
    await db.commit()
    await db.refresh(outlet)
    return PayNowQrRead(outlet_id=outlet.id, paynow_qr_url=None)


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
