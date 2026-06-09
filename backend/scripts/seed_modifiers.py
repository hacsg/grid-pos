"""
Seed script for the gelato modifier use case.

Run after the modifier migrations have been applied:

    cd backend
    python -m scripts.seed_modifiers

It will:
- Create/find "Gelato Flavors" and "Cone/Cup" modifier groups
- Create the specified options
- Look up products named "Single Scoop" and "Double Scoop" by name
- Assign the groups with the required min/max/is_required settings

All prices are in SGD.
"""

import asyncio
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.modifier import ModifierGroup, ModifierOption, ProductModifierGroup
from app.models.product import Product


GELATO_FLAVORS = [
    "Vanilla",
    "Chocolate",
    "Strawberry",
    "Pistachio",
    "Mango Sorbet",
    "Cookie Dough",
    "Matcha",
    "Coffee",
]

CONE_CUP = [
    ("Waffle Cone", Decimal("1.50")),
    ("Sugar Cone", Decimal("0.00")),
    ("Cup", Decimal("0.00")),
]


async def get_or_create_group(session: AsyncSession, name: str, description: str | None, sort_order: int = 0) -> ModifierGroup:
    result = await session.execute(select(ModifierGroup).where(ModifierGroup.name == name))
    existing = result.scalar_one_or_none()
    if existing:
        if description is not None and existing.description != description:
            existing.description = description
        if existing.sort_order != sort_order:
            existing.sort_order = sort_order
        await session.commit()
        await session.refresh(existing)
        return existing

    group = ModifierGroup(name=name, description=description, sort_order=sort_order)
    session.add(group)
    await session.commit()
    await session.refresh(group)
    return group


async def ensure_options(session: AsyncSession, group: ModifierGroup, specs: list[tuple[str, Decimal] | str]) -> None:
    """specs can be list of names (price 0) or list of (name, price) tuples."""
    existing = {opt.name: opt for opt in (group.options or [])}

    for spec in specs:
        if isinstance(spec, tuple):
            name, price = spec
        else:
            name, price = spec, Decimal("0.00")

        if name in existing:
            opt = existing[name]
            if opt.price_adjustment != price:
                opt.price_adjustment = price
            continue

        # Find next display_order
        next_order = max([o.display_order for o in existing.values()], default=-1) + 1
        opt = ModifierOption(
            group_id=group.id,
            name=name,
            price_adjustment=price,
            display_order=next_order,
            is_available=True,
        )
        session.add(opt)
        existing[name] = opt  # prevent dups in same run

    await session.commit()


async def assign_group(
    session: AsyncSession,
    product: Product,
    group: ModifierGroup,
    min_select: int,
    max_select: int,
    is_required: bool = True,
) -> None:
    # Check existing assignment
    result = await session.execute(
        select(ProductModifierGroup).where(
            ProductModifierGroup.product_id == product.id,
            ProductModifierGroup.group_id == group.id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.min_select = min_select
        existing.max_select = max_select
        existing.is_required = is_required
        await session.commit()
        return

    assignment = ProductModifierGroup(
        product_id=product.id,
        group_id=group.id,
        min_select=min_select,
        max_select=max_select,
        is_required=is_required,
        display_order=0,
    )
    session.add(assignment)
    await session.commit()


async def find_product_by_name(session: AsyncSession, name: str) -> Product | None:
    result = await session.execute(select(Product).where(Product.name == name))
    return result.scalar_one_or_none()


async def main() -> None:
    async with AsyncSessionLocal() as session:
        # 1. Groups
        flavors = await get_or_create_group(session, "Gelato Flavors", "Choose your gelato flavor(s)", sort_order=0)
        cone = await get_or_create_group(session, "Cone/Cup", "Choose your serving", sort_order=1)

        # 2. Options
        await ensure_options(session, flavors, GELATO_FLAVORS)
        await ensure_options(session, cone, CONE_CUP)

        # 3. Products (by name)
        single = await find_product_by_name(session, "Single Scoop")
        double = await find_product_by_name(session, "Double Scoop")

        if single is None and double is None:
            print("Neither 'Single Scoop' nor 'Double Scoop' products were found. Seed created groups/options only.")
            return

        # 4. Assignments per spec
        if single:
            await assign_group(session, single, flavors, min_select=1, max_select=1, is_required=True)
            await assign_group(session, single, cone, min_select=0, max_select=1, is_required=False)
            print(f"Assigned modifiers to Single Scoop ({single.id})")

        if double:
            await assign_group(session, double, flavors, min_select=2, max_select=2, is_required=True)
            await assign_group(session, double, cone, min_select=0, max_select=1, is_required=False)
            print(f"Assigned modifiers to Double Scoop ({double.id})")

        print("Modifier seed completed.")


if __name__ == "__main__":
    asyncio.run(main())
