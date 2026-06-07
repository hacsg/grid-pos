"""Catalog API routes for categories, products, and modifiers."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.category import Category
from app.models.modifier import Modifier, ModifierGroup
from app.models.outlet import Outlet
from app.models.product import Product
from app.schemas.category import CategoryCreate, CategoryRead, CategoryUpdate
from app.schemas.modifier import (
    ModifierCreate,
    ModifierGroupCreate,
    ModifierGroupRead,
    ModifierGroupUpdate,
    ModifierRead,
    ModifierUpdate,
)
from app.schemas.product import ProductCreate, ProductDetailRead, ProductRead, ProductUpdate

router = APIRouter(tags=["catalog"])


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


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(payload: CategoryCreate, db: AsyncSession = Depends(get_db)) -> Category:
    """Create a product category."""
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
    """List categories, optionally scoped to an outlet."""
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
    """Return one category by id."""
    return await _load_category_or_404(db, category_id)


@router.patch("/categories/{category_id}", response_model=CategoryRead)
async def update_category(
    category_id: UUID,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
) -> Category:
    """Update a product category."""
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
    """Delete a category."""
    category = await _load_category_or_404(db, category_id)
    await db.delete(category)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/products", response_model=ProductDetailRead, status_code=status.HTTP_201_CREATED)
async def create_product(payload: ProductCreate, db: AsyncSession = Depends(get_db)) -> Product:
    """Create a product."""
    await _load_category_or_404(db, payload.category_id)
    product = Product(**payload.model_dump())
    db.add(product)
    await db.commit()
    return await _load_product_or_404(db, product.id)


@router.get("/products", response_model=list[ProductDetailRead])
async def list_products(
    category_id: UUID | None = None,
    outlet_id: UUID | None = None,
    available_only: bool = False,
    db: AsyncSession = Depends(get_db),
) -> list[Product]:
    """List products with category and modifier data."""
    statement = select(Product).options(
        selectinload(Product.category),
        selectinload(Product.modifier_groups).selectinload(ModifierGroup.modifiers),
    )
    if category_id is not None:
        statement = statement.where(Product.category_id == category_id)
    if outlet_id is not None:
        statement = statement.join(Product.category).where(
            (Category.outlet_id == outlet_id) | (Category.outlet_id.is_(None))
        )
    if available_only:
        statement = statement.where(Product.is_available.is_(True))
    statement = statement.order_by(Product.name)
    result = await db.execute(statement)
    return list(result.scalars().unique().all())


@router.get("/products/{product_id}", response_model=ProductDetailRead)
async def get_product(product_id: UUID, db: AsyncSession = Depends(get_db)) -> Product:
    """Return one product by id."""
    return await _load_product_or_404(db, product_id)


@router.patch("/products/{product_id}", response_model=ProductDetailRead)
async def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: AsyncSession = Depends(get_db),
) -> Product:
    """Update a product."""
    product = await _load_product_or_404(db, product_id)
    update_data = payload.model_dump(exclude_unset=True)
    if "category_id" in update_data:
        await _load_category_or_404(db, update_data["category_id"])
    for field, value in update_data.items():
        setattr(product, field, value)
    await db.commit()
    return await _load_product_or_404(db, product.id)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Delete a product and its modifier groups."""
    product = await _load_product_or_404(db, product_id)
    await db.delete(product)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/modifier-groups", response_model=ModifierGroupRead, status_code=status.HTTP_201_CREATED)
async def create_modifier_group(
    payload: ModifierGroupCreate,
    db: AsyncSession = Depends(get_db),
) -> ModifierGroup:
    """Create a modifier group for a product."""
    await _load_product_or_404(db, payload.product_id)
    modifier_group = ModifierGroup(**payload.model_dump())
    db.add(modifier_group)
    await db.commit()
    return await _load_modifier_group_or_404(db, modifier_group.id)


@router.get("/modifier-groups", response_model=list[ModifierGroupRead])
async def list_modifier_groups(
    product_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[ModifierGroup]:
    """List modifier groups, optionally for one product."""
    statement = select(ModifierGroup).options(selectinload(ModifierGroup.modifiers))
    if product_id is not None:
        statement = statement.where(ModifierGroup.product_id == product_id)
    statement = statement.order_by(ModifierGroup.name)
    result = await db.execute(statement)
    return list(result.scalars().unique().all())


@router.patch("/modifier-groups/{modifier_group_id}", response_model=ModifierGroupRead)
async def update_modifier_group(
    modifier_group_id: UUID,
    payload: ModifierGroupUpdate,
    db: AsyncSession = Depends(get_db),
) -> ModifierGroup:
    """Update a modifier group."""
    modifier_group = await _load_modifier_group_or_404(db, modifier_group_id)
    update_data = payload.model_dump(exclude_unset=True)
    proposed_min = update_data.get("min_select", modifier_group.min_select)
    proposed_max = update_data.get("max_select", modifier_group.max_select)
    proposed_required = update_data.get("required", modifier_group.required)
    if proposed_min > proposed_max:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="min_select cannot exceed max_select")
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
    """Delete a modifier group and its modifiers."""
    modifier_group = await _load_modifier_group_or_404(db, modifier_group_id)
    await db.delete(modifier_group)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/modifiers", response_model=ModifierRead, status_code=status.HTTP_201_CREATED)
async def create_modifier(payload: ModifierCreate, db: AsyncSession = Depends(get_db)) -> Modifier:
    """Create a modifier inside a modifier group."""
    await _load_modifier_group_or_404(db, payload.modifier_group_id)
    modifier = Modifier(**payload.model_dump())
    db.add(modifier)
    await db.commit()
    await db.refresh(modifier)
    return modifier


@router.patch("/modifiers/{modifier_id}", response_model=ModifierRead)
async def update_modifier(
    modifier_id: UUID,
    payload: ModifierUpdate,
    db: AsyncSession = Depends(get_db),
) -> Modifier:
    """Update a modifier."""
    modifier = await _load_modifier_or_404(db, modifier_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(modifier, field, value)
    await db.commit()
    await db.refresh(modifier)
    return modifier


@router.delete("/modifiers/{modifier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier(modifier_id: UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Delete a modifier."""
    modifier = await _load_modifier_or_404(db, modifier_id)
    await db.delete(modifier)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

