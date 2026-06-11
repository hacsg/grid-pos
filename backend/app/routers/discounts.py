"""Discount management API routes."""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.discount import Discount
from app.models.outlet import Outlet
from app.schemas.discount import DiscountCreate, DiscountRead, DiscountUpdate

router = APIRouter(prefix="/discounts", tags=["discounts"])


async def _load_discount_or_404(db: AsyncSession, discount_id: UUID) -> Discount:
    """Load a discount by id or raise a 404 response."""
    discount = await db.get(Discount, discount_id)
    if discount is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discount not found")
    return discount


async def _ensure_outlet_exists(db: AsyncSession, outlet_id: UUID | None) -> None:
    """Validate an outlet id when one is supplied (optional for discounts)."""
    if outlet_id is None:
        return
    outlet = await db.get(Outlet, outlet_id)
    if outlet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outlet not found")


@router.post("", response_model=DiscountRead, status_code=status.HTTP_201_CREATED)
async def create_discount(payload: DiscountCreate, db: AsyncSession = Depends(get_db)) -> Discount:
    """Create a new discount."""
    await _ensure_outlet_exists(db, payload.outlet_id)
    discount = Discount(**payload.model_dump())
    db.add(discount)
    await db.commit()
    await db.refresh(discount)
    return discount


@router.get("", response_model=list[DiscountRead])
async def list_discounts(
    is_active: bool | None = Query(default=None, description="Filter by active status"),
    db: AsyncSession = Depends(get_db),
) -> list[Discount]:
    """List all discounts. Optionally filter by is_active=true/false."""
    statement = select(Discount)
    if is_active is not None:
        statement = statement.where(Discount.is_active == is_active)
    statement = statement.order_by(Discount.sort_order, Discount.name)
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/{discount_id}", response_model=DiscountRead)
async def get_discount(discount_id: UUID, db: AsyncSession = Depends(get_db)) -> Discount:
    """Return one discount by id."""
    return await _load_discount_or_404(db, discount_id)


@router.put("/{discount_id}", response_model=DiscountRead)
async def update_discount(
    discount_id: UUID,
    payload: DiscountUpdate,
    db: AsyncSession = Depends(get_db),
) -> Discount:
    """Update a discount. Only supplied fields are updated."""
    discount = await _load_discount_or_404(db, discount_id)
    update_data = payload.model_dump(exclude_unset=True)
    await _ensure_outlet_exists(db, update_data.get("outlet_id"))
    for field, value in update_data.items():
        setattr(discount, field, value)
    await db.commit()
    await db.refresh(discount)
    return discount


@router.delete("/{discount_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_discount(discount_id: UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Delete a discount."""
    discount = await _load_discount_or_404(db, discount_id)
    await db.delete(discount)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/reorder", response_model=list[DiscountRead])
async def reorder_discounts(payload: dict[str, Any], db: AsyncSession = Depends(get_db)) -> list[Discount]:
    """Batch update sort_order for discounts.

    Accepts { "ids": ["uuid", ...] } and assigns sequential sort_order starting at 0.
    Returns the updated discounts in the new order.
    """
    ids: list[str] = payload.get("ids", []) or payload.get("items", [])
    # Support both {ids: [...]} and legacy {items: [{id, sort_order}, ...]} shapes
    if not ids:
        # Try items shape
        items = payload.get("items", [])
        if items and isinstance(items, list):
            ids = [str(it.get("id")) for it in items if it.get("id")]

    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ids list is required")

    updated: list[Discount] = []
    for index, raw_id in enumerate(ids):
        try:
            discount_id = UUID(str(raw_id))
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid discount id") from None
        discount = await _load_discount_or_404(db, discount_id)
        discount.sort_order = index
        updated.append(discount)

    await db.commit()
    for d in updated:
        await db.refresh(d)
    updated.sort(key=lambda d: d.sort_order)
    return updated


@router.patch("/{discount_id}/toggle", response_model=DiscountRead)
async def toggle_discount_active(
    discount_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> Discount:
    """Toggle the is_active flag for a discount."""
    discount = await _load_discount_or_404(db, discount_id)
    discount.is_active = not bool(discount.is_active)
    await db.commit()
    await db.refresh(discount)
    return discount
