"""Catalog API routes for categories, products, and modifiers."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.category import Category
from app.models.modifier import ModifierGroup, ModifierOption, ProductModifierGroup
from app.models.outlet import Outlet
from app.models.product import Product
from app.models.staff import Staff
from app.schemas.category import (
    CategoryCreate,
    CategoryRead,
    CategoryReorder,
    CategoryUpdate,
)
from app.schemas.modifier import (
    ModifierGroupCreate,
    ModifierGroupRead,
    ModifierGroupReorder,
    ModifierGroupUpdate,
    ModifierOptionCreate,
    ModifierOptionRead,
    ModifierOptionUpdate,
    ProductModifierAssignmentCreate,
    ProductModifierAssignmentRead,
    ProductModifierAssignmentUpdate,
)
from app.schemas.product import (
    ProductAvailabilityUpdate,
    ProductBulkAvailabilityUpdate,
    ProductBulkDelete,
    ProductCreate,
    ProductDetailRead,
    ProductUpdate,
)
from app.utils.auth import get_current_staff

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
            selectinload(Product.modifier_group_assignments).selectinload(
                ProductModifierGroup.group
            ).selectinload(ModifierGroup.options),
        )
        .where(Product.id == product_id)
    )
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


async def _set_products_availability(
    db: AsyncSession, product_ids: list[UUID], is_available: bool
) -> None:
    """Set availability on a batch of products, or 404 if any id is unknown."""
    unique_ids = list(dict.fromkeys(product_ids))
    result = await db.execute(select(Product).where(Product.id.in_(unique_ids)))
    products = list(result.scalars().all())
    if len(products) != len(unique_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    for product in products:
        product.is_available = is_available
    await db.commit()


async def _load_modifier_group_or_404(db: AsyncSession, group_id: UUID) -> ModifierGroup:
    """Load a modifier group with options or raise a 404 response."""
    result = await db.execute(
        select(ModifierGroup)
        .options(selectinload(ModifierGroup.options))
        .where(ModifierGroup.id == group_id)
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modifier group not found")
    return group


async def _load_modifier_option_or_404(db: AsyncSession, option_id: UUID) -> ModifierOption:
    """Load a modifier option by id or raise a 404 response."""
    option = await db.get(ModifierOption, option_id)
    if option is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modifier option not found")
    return option


async def _load_assignment_or_404(
    db: AsyncSession, assignment_id: UUID
) -> ProductModifierGroup:
    """Load a product-modifier-group assignment or raise 404."""
    result = await db.execute(
        select(ProductModifierGroup)
        .options(
            selectinload(ProductModifierGroup.group).selectinload(ModifierGroup.options)
        )
        .where(ProductModifierGroup.id == assignment_id)
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )
    return assignment


def _build_assignment_read(assignment: ProductModifierGroup) -> ProductModifierAssignmentRead:
    """Build a nested assignment read model including group options."""
    group = assignment.group
    options = [
        ModifierOptionRead.model_validate(opt) for opt in (group.options or [])
    ]
    return ProductModifierAssignmentRead(
        id=assignment.id,
        group_id=group.id,
        group_name=group.name,
        group_description=group.description,
        min_select=assignment.min_select,
        max_select=assignment.max_select,
        is_required=assignment.is_required,
        display_order=assignment.display_order,
        options=options,
    )


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Category:
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
    current_staff: Staff = Depends(get_current_staff),
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
async def delete_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Response:
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
    current_staff: Staff = Depends(get_current_staff),
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
async def create_product(
    payload: ProductCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Product:
    """Create a product.

    Returns the newly created product with category and modifier data.
    Raises 404 if the referenced category does not exist.
    """
    await _load_category_or_404(db, payload.category_id)
    product = Product(**payload.model_dump())
    db.add(product)
    await db.commit()
    product = await _load_product_or_404(db, product.id)
    product.modifier_groups = [
        _build_assignment_read(a) for a in (product.modifier_group_assignments or [])
    ]
    return product


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
    Modifier groups (with options) assigned to each product are included.
    """
    statement = select(Product).options(
        selectinload(Product.category),
        selectinload(Product.modifier_group_assignments)
        .selectinload(ProductModifierGroup.group)
        .selectinload(ModifierGroup.options),
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
    products = list(result.scalars().unique().all())
    # Re-attach computed modifier_groups for response serialization
    for p in products:
        p.modifier_groups = [
            _build_assignment_read(a) for a in (p.modifier_group_assignments or [])
        ]
    return products


@router.post("/products/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
async def bulk_delete_products(
    payload: ProductBulkDelete,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Response:
    """Soft-delete several products at once.

    Mirrors the single-product delete: the rows are kept and only marked
    unavailable, so past orders keep resolving their product names.
    """
    await _set_products_availability(db, payload.ids, False)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/products/bulk-availability", status_code=status.HTTP_204_NO_CONTENT)
async def bulk_set_product_availability(
    payload: ProductBulkAvailabilityUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Response:
    """Set availability on several products at once."""
    await _set_products_availability(db, payload.ids, payload.is_available)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/products/{product_id}", response_model=ProductDetailRead)
async def get_product(product_id: UUID, db: AsyncSession = Depends(get_db)) -> Product:
    """Return one product by id with category and modifier data.

    Raises 404 if the product does not exist.
    """
    product = await _load_product_or_404(db, product_id)
    product.modifier_groups = [
        _build_assignment_read(a) for a in (product.modifier_group_assignments or [])
    ]
    return product


@router.put("/products/{product_id}", response_model=ProductDetailRead)
async def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
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
    # Ensure relationships (esp. category) are fresh for response
    await db.refresh(product)
    product = await _load_product_or_404(db, product.id)
    product.modifier_groups = [
        _build_assignment_read(a) for a in (product.modifier_group_assignments or [])
    ]
    return product


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Response:
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
    current_staff: Staff = Depends(get_current_staff),
) -> Product:
    """Toggle a product's availability status.

    Accepts ``{ "is_available": true }`` or ``{ "is_available": false }``
    and updates the product accordingly. Raises 404 if the product does not
    exist.
    """
    product = await _load_product_or_404(db, product_id)
    product.is_available = payload.is_available
    await db.commit()
    product = await _load_product_or_404(db, product.id)
    product.modifier_groups = [
        _build_assignment_read(a) for a in (product.modifier_group_assignments or [])
    ]
    return product


# ---------------------------------------------------------------------------
# Modifier Groups (standalone)
# ---------------------------------------------------------------------------


@router.get("/modifier-groups", response_model=list[ModifierGroupRead])
async def list_modifier_groups(db: AsyncSession = Depends(get_db)) -> list[ModifierGroup]:
    """List all modifier groups with their options."""
    result = await db.execute(
        select(ModifierGroup)
        .options(selectinload(ModifierGroup.options))
        .order_by(ModifierGroup.sort_order, ModifierGroup.name)
    )
    return list(result.scalars().all())


@router.post(
    "/modifier-groups",
    response_model=ModifierGroupRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_modifier_group(
    payload: ModifierGroupCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ModifierGroup:
    """Create a new modifier group."""
    group = ModifierGroup(**payload.model_dump())
    db.add(group)
    await db.commit()
    return await _load_modifier_group_or_404(db, group.id)


@router.put("/modifier-groups/{group_id}", response_model=ModifierGroupRead)
async def update_modifier_group(
    group_id: UUID,
    payload: ModifierGroupUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ModifierGroup:
    """Update a modifier group (name/description)."""
    group = await _load_modifier_group_or_404(db, group_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await db.commit()
    return await _load_modifier_group_or_404(db, group.id)


@router.delete("/modifier-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Response:
    """Delete a modifier group (cascades to its options and product assignments)."""
    group = await _load_modifier_group_or_404(db, group_id)
    await db.delete(group)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Modifier Options
# ---------------------------------------------------------------------------


@router.post(
    "/modifier-groups/{group_id}/options",
    response_model=ModifierOptionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_modifier_option(
    group_id: UUID,
    payload: ModifierOptionCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ModifierOption:
    """Add an option to a modifier group."""
    await _load_modifier_group_or_404(db, group_id)
    option = ModifierOption(**{**payload.model_dump(), "group_id": group_id})
    db.add(option)
    await db.commit()
    await db.refresh(option)
    return option


@router.put("/modifier-options/{option_id}", response_model=ModifierOptionRead)
async def update_modifier_option(
    option_id: UUID,
    payload: ModifierOptionUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ModifierOption:
    """Update a modifier option."""
    option = await _load_modifier_option_or_404(db, option_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(option, field, value)
    await db.commit()
    await db.refresh(option)
    return option


@router.delete("/modifier-options/{option_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier_option(
    option_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Response:
    """Delete a modifier option."""
    option = await _load_modifier_option_or_404(db, option_id)
    await db.delete(option)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Product Modifier Group Assignments
# ---------------------------------------------------------------------------


@router.get(
    "/products/{product_id}/modifier-groups",
    response_model=list[ProductModifierAssignmentRead],
)
async def list_product_modifier_groups(
    product_id: UUID, db: AsyncSession = Depends(get_db)
) -> list[ProductModifierAssignmentRead]:
    """List modifier groups currently assigned to a product."""
    product = await _load_product_or_404(db, product_id)
    assignments: list[ProductModifierAssignmentRead] = []
    for a in product.modifier_group_assignments or []:
        assignments.append(_build_assignment_read(a))
    # sort by display_order then name for stability
    assignments.sort(key=lambda x: (x.display_order, x.group_name))
    return assignments


@router.post(
    "/products/{product_id}/modifier-groups",
    response_model=ProductModifierAssignmentRead,
    status_code=status.HTTP_201_CREATED,
)
async def assign_modifier_group_to_product(
    product_id: UUID,
    payload: ProductModifierAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ProductModifierAssignmentRead:
    """Assign a modifier group to a product.

    Body: { group_id, min_select, max_select, is_required, display_order }
    """
    await _load_product_or_404(db, product_id)
    await _load_modifier_group_or_404(db, payload.group_id)

    # Prevent duplicate assignment
    existing = await db.execute(
        select(ProductModifierGroup).where(
            ProductModifierGroup.product_id == product_id,
            ProductModifierGroup.group_id == payload.group_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Modifier group already assigned to this product",
        )

    assignment = ProductModifierGroup(
        product_id=product_id,
        group_id=payload.group_id,
        min_select=payload.min_select,
        max_select=payload.max_select,
        is_required=payload.is_required,
        display_order=payload.display_order,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    # reload with relations for response
    assignment = await _load_assignment_or_404(db, assignment.id)
    return _build_assignment_read(assignment)


@router.put(
    "/products/{product_id}/modifier-groups/{assignment_id}",
    response_model=ProductModifierAssignmentRead,
)
async def update_product_modifier_assignment(
    product_id: UUID,
    assignment_id: UUID,
    payload: ProductModifierAssignmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> ProductModifierAssignmentRead:
    """Update assignment settings (min/max/required/display_order)."""
    # Verify product exists (also ensures 404 for bad product)
    await _load_product_or_404(db, product_id)
    assignment = await _load_assignment_or_404(db, assignment_id)
    if assignment.product_id != product_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )

    update_data = payload.model_dump(exclude_unset=True)
    # Validate bounds if both provided or mixed with existing
    new_min = update_data.get("min_select", assignment.min_select)
    new_max = update_data.get("max_select", assignment.max_select)
    if new_min > new_max:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="min_select cannot exceed max_select",
        )

    for field, value in update_data.items():
        setattr(assignment, field, value)
    await db.commit()
    assignment = await _load_assignment_or_404(db, assignment.id)
    return _build_assignment_read(assignment)


@router.delete("/products/{product_id}/modifier-groups/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_modifier_group_from_product(
    product_id: UUID,
    assignment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Response:
    """Remove a modifier group assignment from a product."""
    await _load_product_or_404(db, product_id)
    assignment = await _load_assignment_or_404(db, assignment_id)
    if assignment.product_id != product_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )
    await db.delete(assignment)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/products/{product_id}/modifier-groups/reorder",
    response_model=list[ProductModifierAssignmentRead],
)
async def reorder_product_modifier_groups(
    product_id: UUID,
    payload: ModifierGroupReorder,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[ProductModifierAssignmentRead]:
    """Update the display_order for multiple modifier group assignments at once.

    Accepts a list of assignment id / sort_order pairs and applies them in a
    single request. Returns the updated assignments in display_order order.
    """
    await _load_product_or_404(db, product_id)
    updated: list[ProductModifierGroup] = []
    for item in payload.items:
        assignment = await _load_assignment_or_404(db, item.id)
        if assignment.product_id != product_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
            )
        assignment.display_order = item.sort_order
        updated.append(assignment)
    await db.commit()
    updated.sort(key=lambda x: x.display_order)
    return [_build_assignment_read(a) for a in updated]
