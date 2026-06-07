"""Catalog API routes for categories, products, and modifiers."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.category import Category
from app.models.modifier import Modifier, ModifierGroup
from app.models.outlet import Outlet
from app.models.product import Product
from app.schemas.category import (
    CategoryCreate,
    CategoryRead,
    CategoryReorder,
    CategoryUpdate,
)
from app.schemas.modifier import (
    ModifierBase,
    ModifierCreate,
    ModifierGroupBase,
    ModifierGroupCreate,
    ModifierGroupRead,
    ModifierGroupUpdate,
    ModifierRead,
    ModifierUpdate,
)
from app.schemas.product import (
    ProductAvailabilityUpdate,
    ProductCreate,
    ProductDetailRead,
    ProductUpdate,
)

router = APIRouter(tags=["catalog"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _ensure_outlet_exists(db: AsyncSession, outlet_id: UUID | None) -> None:
    """Validate an outlet id when one is supplied."""
    if outlet_id is None:
        return
    if await db.get(Outlet, outlet_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outlet not found")


async def _load_category_or_404(db: AsyncSession, category_id: UUID) -> Category:
    """Load a category by id or raise a 404 response."""
    category = await db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return category


async def _load_product_or_404(db: AsyncSession, product_id: UUID) -> Product:
    """Load a product with relationships or raise a 404 response."""
    result = await db.execute(
        select(Product)
        .options(
            selectinload(Product.category),
            selectinload(Product.modifier_groups).selectinload(ModifierGroup.modifiers),
        )
        .where(Product.id == product_id)
    )
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


async def _load_modifier_group_or_404(db: AsyncSession, modifier_group_id: UUID) -> ModifierGroup:
    """Load a modifier group with modifiers or raise a 404 response."""
    result = await db.execute(
        select(ModifierGroup)
        .options(selectinload(ModifierGroup.modifiers))
        .where(ModifierGroup.id == modifier_group_id)
    )
    modifier_group = result.scalar_one_or_none()
    if modifier_group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modifier group not found")
    return modifier_group


async def _load_modifier_or_404(db: AsyncSession, modifier_id: UUID) -> Modifier:
    """Load a modifier by id or raise a 404 response."""
    modifier = await db.get(Modifier, modifier_id)
    if modifier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modifier not found")
    return modifier


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(payload: CategoryCreate, db: AsyncSession = Depends(get_db)) -> Category:
    """Create a product category.

    Returns the newly created category with a 201 status.
    """
    await _ensure_outlet_exists(db, payload.outlet_id)
    category = Category(**payload.model_dump())
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(
    outlet_id: UUID | None = None,
    include_global: bool = True,
    db: AsyncSession = Depends(get_db),
) -> list[Category]:
    """List categories, optionally scoped to an outlet.

    - **outlet_id** — filter to a specific outlet
    - **include_global** — when filtering by outlet, also include categories with no outlet
    """
    statement = select(Category)
    if outlet_id is not None:
        if include_global:
            statement = statement.where((Category.outlet_id == outlet_id) | (Category.outlet_id.is_(None)))
        else:
            statement = statement.where(Category.outlet_id == outlet_id)
    statement = statement.order_by(Category.sort_order, Category.name)
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/categories/{category_id}", response_model=CategoryRead)
async def get_category(category_id: UUID, db: AsyncSession = Depends(get_db)) -> Category:
    """Return one category by id.

    Raises 404 if the category does not exist.
    """
    return await _load_category_or_404(db, category_id)


@router.put("/categories/{category_id}", response_model=CategoryRead)
async def update_category(
    category_id: UUID,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
) -> Category:
    """Update a product category.

    Only supplied fields are updated. Raises 404 if the category does not exist.
    """
    category = await _load_category_or_404(db, category_id)
    update_data = payload.model_dump(exclude_unset=True)
    await _ensure_outlet_exists(db, update_data.get("outlet_id"))
    for field, value in update_data.items():
        setattr(category, field, value)
    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Delete a category.

    Raises 409 if the category still has products assigned to it.
    Raises 404 if the category does not exist.
    """
    category = await _load_category_or_404(db, category_id)

    # Check for existing products before deletion.
    result = await db.execute(select(Product).where(Product.category_id == category_id).limit(1))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete category with existing products",
        )

    await db.delete(category)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/categories/reorder", response_model=list[CategoryRead])
async def reorder_categories(
    payload: CategoryReorder,
    db: AsyncSession = Depends(get_db),
) -> list[Category]:
    """Update the sort_order for multiple categories at once.

    Accepts a list of category id / sort_order pairs and applies them in a
    single request. Returns the updated categories in sort_order order.
    """
    updated: list[Category] = []
    for item in payload.items:
        category = await _load_category_or_404(db, item.id)
        category.sort_order = item.sort_order
        updated.append(category)
    await db.commit()
    for category in updated:
        await db.refresh(category)
    updated.sort(key=lambda c: c.sort_order)
    return updated


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------


@router.post("/products", response_model=ProductDetailRead, status_code=status.HTTP_201_CREATED)
async def create_product(payload: ProductCreate, db: AsyncSession = Depends(get_db)) -> Product:
    """Create a product.

    Returns the newly created product with category and modifier data.
    Raises 404 if the referenced category does not exist.
    """
    await _load_category_or_404(db, payload.category_id)
    product = Product(**payload.model_dump())
    db.add(product)
    await db.commit()
    return await _load_product_or_404(db, product.id)


@router.get("/products", response_model=list[ProductDetailRead])
async def list_products(
    category_id: UUID | None = None,
    is_available: bool | None = None,
    outlet_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[Product]:
    """List products with optional filters.

    - **category_id** — filter by category
    - **is_available** — filter by availability status
    - **outlet_id** — filter by outlet (via category's outlet_id)
    """
    statement = select(Product).options(
        selectinload(Product.category),
        selectinload(Product.modifier_groups).selectinload(ModifierGroup.modifiers),
    )
    if category_id is not None:
        statement = statement.where(Product.category_id == category_id)
    if is_available is not None:
        statement = statement.where(Product.is_available.is_(is_available))
    if outlet_id is not None:
        statement = statement.join(Product.category).where(
            (Category.outlet_id == outlet_id) | (Category.outlet_id.is_(None))
        )
    statement = statement.order_by(Product.name)
    result = await db.execute(statement)
    return list(result.scalars().unique().all())


@router.get("/products/{product_id}", response_model=ProductDetailRead)
async def get_product(product_id: UUID, db: AsyncSession = Depends(get_db)) -> Product:
    """Return one product by id with category and modifier data.

    Raises 404 if the product does not exist.
    """
    return await _load_product_or_404(db, product_id)


@router.put("/products/{product_id}", response_model=ProductDetailRead)
async def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: AsyncSession = Depends(get_db),
) -> Product:
    """Update a product.

    Only supplied fields are updated. Raises 404 if the product or
    referenced category does not exist.
    """
    product = await _load_product_or_404(db, product_id)
    update_data = payload.model_dump(exclude_unset=True)
    if "category_id" in update_data:
        await _load_category_or_404(db, update_data["category_id"])
    for field, value in update_data.items():
        setattr(product, field, value)
    await db.commit()
    await db.refresh(product)
    return await _load_product_or_404(db, product.id)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Soft-delete a product by setting is_available to false.

    The product record and its modifier groups are kept in the database.
    Raises 404 if the product does not exist.
    """
    product = await _load_product_or_404(db, product_id)
    product.is_available = False
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/products/{product_id}/availability", response_model=ProductDetailRead)
async def toggle_product_availability(
    product_id: UUID,
    payload: ProductAvailabilityUpdate,
    db: AsyncSession = Depends(get_db),
) -> Product:
    """Toggle a product's availability status.

    Accepts ``{ "is_available": true }`` or ``{ "is_available": false }``
    and updates the product accordingly. Raises 404 if the product does not
    exist.
    """
    product = await _load_product_or_404(db, product_id)
    product.is_available = payload.is_available
    await db.commit()
    return await _load_product_or_404(db, product.id)


# ---------------------------------------------------------------------------
# Modifier Groups
# ---------------------------------------------------------------------------


@router.post(
    "/products/{product_id}/modifier-groups",
    response_model=ModifierGroupRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_product_modifier_group(
    product_id: UUID,
    payload: ModifierGroupBase,
    db: AsyncSession = Depends(get_db),
) -> ModifierGroup:
    """Add a modifier group to a product.

    The ``product_id`` in the URL path is used; any ``product_id`` in the
    request body is ignored. Raises 404 if the product does not exist.
    """
    await _load_product_or_404(db, product_id)
    modifier_group = ModifierGroup(**{**payload.model_dump(), "product_id": product_id})
    db.add(modifier_group)
    await db.commit()
    return await _load_modifier_group_or_404(db, modifier_group.id)


@router.put("/modifier-groups/{modifier_group_id}", response_model=ModifierGroupRead)
async def update_modifier_group(
    modifier_group_id: UUID,
    payload: ModifierGroupUpdate,
    db: AsyncSession = Depends(get_db),
) -> ModifierGroup:
    """Update a modifier group.

    Validates selection bounds before applying changes.
    Raises 404 if the modifier group does not exist.
    Raises 400 on invalid selection constraints.
    """
    modifier_group = await _load_modifier_group_or_404(db, modifier_group_id)
    update_data = payload.model_dump(exclude_unset=True)
    proposed_min = update_data.get("min_select", modifier_group.min_select)
    proposed_max = update_data.get("max_select", modifier_group.max_select)
    proposed_required = update_data.get("required", modifier_group.required)
    if proposed_min > proposed_max:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="min_select cannot exceed max_select",
        )
    if proposed_required and proposed_min == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="required modifier groups must have min_select greater than 0",
        )
    for field, value in update_data.items():
        setattr(modifier_group, field, value)
    await db.commit()
    return await _load_modifier_group_or_404(db, modifier_group.id)


@router.delete("/modifier-groups/{modifier_group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier_group(
    modifier_group_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a modifier group and all its modifiers.

    Raises 404 if the modifier group does not exist.
    """
    modifier_group = await _load_modifier_group_or_404(db, modifier_group_id)
    await db.delete(modifier_group)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Modifiers
# ---------------------------------------------------------------------------


@router.post(
    "/modifier-groups/{group_id}/modifiers",
    response_model=ModifierRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_modifier_in_group(
    group_id: UUID,
    payload: ModifierBase,
    db: AsyncSession = Depends(get_db),
) -> Modifier:
    """Add a modifier to a modifier group.

    The ``modifier_group_id`` in the URL path is used; any
    ``modifier_group_id`` in the request body is ignored. Raises 404 if the
    modifier group does not exist.
    """
    await _load_modifier_group_or_404(db, group_id)
    modifier = Modifier(**{**payload.model_dump(), "modifier_group_id": group_id})
    db.add(modifier)
    await db.commit()
    await db.refresh(modifier)
    return modifier


@router.put("/modifiers/{modifier_id}", response_model=ModifierRead)
async def update_modifier(
    modifier_id: UUID,
    payload: ModifierUpdate,
    db: AsyncSession = Depends(get_db),
) -> Modifier:
    """Update a modifier.

    Only supplied fields are updated. Raises 404 if the modifier does not
    exist.
    """
    modifier = await _load_modifier_or_404(db, modifier_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(modifier, field, value)
    await db.commit()
    await db.refresh(modifier)
    return modifier


@router.delete("/modifiers/{modifier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier(modifier_id: UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Delete a modifier.

    Raises 404 if the modifier does not exist.
    """
    modifier = await _load_modifier_or_404(db, modifier_id)
    await db.delete(modifier)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)