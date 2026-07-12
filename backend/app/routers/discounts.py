"""Discount management API routes."""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.category import Category
from app.models.discount import Discount
from app.models.outlet import Outlet
from app.models.product import Product
from app.models.staff import Staff
from app.schemas.discount import DiscountCreate, DiscountRead, DiscountUpdate
from app.utils.auth import get_current_staff

router = APIRouter(prefix="/discounts", tags=["discounts"])

# Targeting relationships must be eager-loaded: DiscountRead serializes the
# target id lists, and lazy-loading them would fail under the async session.
_TARGET_LOADS = (
    selectinload(Discount.target_categories),
    selectinload(Discount.target_products),
)


async def _load_discount_or_404(db: AsyncSession, discount_id: UUID) -> Discount:
    """Load a discount (with targets eager-loaded) by id or raise a 404."""
    result = await db.execute(
        select(Discount).where(Discount.id == discount_id).options(*_TARGET_LOADS)
    )
    discount = result.scalar_one_or_none()
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


async def _resolve_categories(db: AsyncSession, category_ids: list[UUID]) -> list[Category]:
    """Load the given categories, 404-ing if any id is unknown."""
    if not category_ids:
        return []
    result = await db.execute(select(Category).where(Category.id.in_(category_ids)))
    categories = list(result.scalars().all())
    if len(categories) != len(set(category_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more categories not found")
    return categories


async def _resolve_products(db: AsyncSession, product_ids: list[UUID]) -> list[Product]:
    """Load the given products, 404-ing if any id is unknown."""
    if not product_ids:
        return []
    result = await db.execute(select(Product).where(Product.id.in_(product_ids)))
    products = list(result.scalars().all())
    if len(products) != len(set(product_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more products not found")
    return products


@router.post("", response_model=DiscountRead, status_code=status.HTTP_201_CREATED)
async def create_discount(
    payload: DiscountCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Discount:
    """Create a new discount."""
    await _ensure_outlet_exists(db, payload.outlet_id)
    data = payload.model_dump()
    category_ids = data.pop("target_category_ids", [])
    product_ids = data.pop("target_product_ids", [])
    discount = Discount(**data)
    discount.target_categories = await _resolve_categories(db, category_ids)
    discount.target_products = await _resolve_products(db, product_ids)
    db.add(discount)
    await db.commit()
    return await _load_discount_or_404(db, discount.id)


@router.get("", response_model=list[DiscountRead])
async def list_discounts(
    is_active: bool | None = Query(default=None, description="Filter by active status"),
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[Discount]:
    """List all discounts. Optionally filter by is_active=true/false."""
    statement = select(Discount).options(*_TARGET_LOADS)
    if is_active is not None:
        statement = statement.where(Discount.is_active == is_active)
    statement = statement.order_by(Discount.sort_order, Discount.name)
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/{discount_id}", response_model=DiscountRead)
async def get_discount(
    discount_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Discount:
    """Return one discount by id."""
    return await _load_discount_or_404(db, discount_id)


@router.put("/{discount_id}", response_model=DiscountRead)
async def update_discount(
    discount_id: UUID,
    payload: DiscountUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Discount:
    """Update a discount. Only supplied fields are updated."""
    discount = await _load_discount_or_404(db, discount_id)
    update_data = payload.model_dump(exclude_unset=True)
    await _ensure_outlet_exists(db, update_data.get("outlet_id"))
    category_ids = update_data.pop("target_category_ids", None)
    product_ids = update_data.pop("target_product_ids", None)
    for field, value in update_data.items():
        setattr(discount, field, value)
    if category_ids is not None:
        discount.target_categories = await _resolve_categories(db, category_ids)
    if product_ids is not None:
        discount.target_products = await _resolve_products(db, product_ids)
    await db.commit()
    return await _load_discount_or_404(db, discount.id)


@router.delete("/{discount_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_discount(
    discount_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Response:
    """Delete a discount."""
    discount = await _load_discount_or_404(db, discount_id)
    await db.delete(discount)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/reorder", response_model=list[DiscountRead])
async def reorder_discounts(
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[Discount]:
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
    # expire_on_commit=False keeps the eager-loaded targets and updated
    # sort_order intact, so no refresh (which would lazy-load) is needed.
    updated.sort(key=lambda d: d.sort_order)
    return updated


@router.patch("/{discount_id}/toggle", response_model=DiscountRead)
async def toggle_discount_active(
    discount_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Discount:
    """Toggle the is_active flag for a discount."""
    discount = await _load_discount_or_404(db, discount_id)
    discount.is_active = not bool(discount.is_active)
    await db.commit()
    return discount
