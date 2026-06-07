"""Shared pytest fixtures for Grid POS API tests.

Uses an in-memory SQLite database (via aiosqlite) to keep tests fast and
isolated. All tables are created before each test session and dropped after.
"""

from collections.abc import AsyncGenerator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app
from app.models import (  # noqa: F401  — registers models on Base.metadata
    Category,
    Modifier,
    ModifierGroup,
    Outlet,
    Product,
    Staff,
)
from app.models.staff import StaffRole
from app.utils.hashing import hash_pin

# ---------------------------------------------------------------------------
# Use an in-memory SQLite database for all tests.
# ---------------------------------------------------------------------------
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(
    test_engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


@pytest_asyncio.fixture(autouse=True)
async def setup_database() -> AsyncGenerator[None, None]:
    """Create all tables before each test and drop them after.

    Using ``autouse=True`` ensures each test runs against a clean database.
    """
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
    """Override the FastAPI dependency with the test database session."""
    async with TestSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a raw test database session for direct model operations."""
    async with TestSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Provide an HTTPX async client wired to the test app.

    The FastAPI ``get_db`` dependency is overridden to use the in-memory
    SQLite database so that tests do not touch the real database.
    """
    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Factory helpers – convenience functions that create model instances and
# commit them to the database, returning the ORM objects.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def outlet(db_session: AsyncSession) -> Any:
    """Create a default outlet for tests that need one."""
    from app.models.outlet import Outlet

    obj = Outlet(name="Test Outlet", address="123 Main St")
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def category(db_session: AsyncSession, outlet: Any) -> Any:
    """Create a default category for tests that need one."""
    obj = Category(name="Test Category", sort_order=0, outlet_id=outlet.id)
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def other_category(db_session: AsyncSession, outlet: Any) -> Any:
    """Create a second category for tests that need two."""
    obj = Category(name="Other Category", sort_order=1, outlet_id=outlet.id)
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def product(db_session: AsyncSession, category: Any) -> Any:
    """Create a default product for tests that need one."""
    obj = Product(name="Test Product", price=9.99, category_id=category.id, is_available=True)
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def modifier_group(db_session: AsyncSession, product: Any) -> Any:
    """Create a default modifier group for tests that need one."""
    obj = ModifierGroup(name="Size", product_id=product.id)
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def modifier(db_session: AsyncSession, modifier_group: Any) -> Any:
    """Create a default modifier for tests that need one."""
    obj = Modifier(name="Large", price_adjustment=1.50, modifier_group_id=modifier_group.id)
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


# ---------------------------------------------------------------------------
# Staff fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def admin_staff(db_session: AsyncSession, outlet: Any) -> Any:
    """Create an admin staff member for the default outlet."""
    obj = Staff(
        name="Admin User",
        role=StaffRole.admin,
        outlet_id=outlet.id,
        pin_hash=hash_pin("0000"),
        is_active=True,
    )
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def manager_staff(db_session: AsyncSession, outlet: Any) -> Any:
    """Create a manager staff member for the default outlet."""
    obj = Staff(
        name="Manager User",
        role=StaffRole.manager,
        outlet_id=outlet.id,
        pin_hash=hash_pin("1111"),
        is_active=True,
    )
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def supervisor_staff(db_session: AsyncSession, outlet: Any) -> Any:
    """Create a supervisor staff member for the default outlet."""
    obj = Staff(
        name="Supervisor User",
        role=StaffRole.supervisor,
        outlet_id=outlet.id,
        pin_hash=hash_pin("2222"),
        is_active=True,
    )
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def cashier_staff(db_session: AsyncSession, outlet: Any) -> Any:
    """Create a cashier staff member for the default outlet."""
    obj = Staff(
        name="Cashier User",
        role=StaffRole.cashier,
        outlet_id=outlet.id,
        pin_hash=hash_pin("1234"),
        is_active=True,
    )
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def inactive_staff(db_session: AsyncSession, outlet: Any) -> Any:
    """Create an inactive staff member."""
    obj = Staff(
        name="Inactive User",
        role=StaffRole.cashier,
        outlet_id=outlet.id,
        pin_hash=hash_pin("9999"),
        is_active=False,
    )
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj


@pytest_asyncio.fixture
async def admin_token(admin_staff: Any) -> str:
    """Return a valid JWT for the admin staff member."""
    from app.utils.auth import create_access_token

    return create_access_token(
        subject=admin_staff.id,
        role=admin_staff.role.value,
        outlet_id=admin_staff.outlet_id,
    )


@pytest_asyncio.fixture
async def manager_token(manager_staff: Any) -> str:
    """Return a valid JWT for the manager staff member."""
    from app.utils.auth import create_access_token

    return create_access_token(
        subject=manager_staff.id,
        role=manager_staff.role.value,
        outlet_id=manager_staff.outlet_id,
    )


@pytest_asyncio.fixture
async def supervisor_token(supervisor_staff: Any) -> str:
    """Return a valid JWT for the supervisor staff member."""
    from app.utils.auth import create_access_token

    return create_access_token(
        subject=supervisor_staff.id,
        role=supervisor_staff.role.value,
        outlet_id=supervisor_staff.outlet_id,
    )


@pytest_asyncio.fixture
async def cashier_token(cashier_staff: Any) -> str:
    """Return a valid JWT for the cashier staff member."""
    from app.utils.auth import create_access_token

    return create_access_token(
        subject=cashier_staff.id,
        role=cashier_staff.role.value,
        outlet_id=cashier_staff.outlet_id,
    )


@pytest_asyncio.fixture
async def another_outlet(db_session: AsyncSession) -> Any:
    """Create a second outlet for tests that need cross-outlet scenarios."""
    from app.models.outlet import Outlet

    obj = Outlet(name="Another Outlet", address="456 Oak Ave")
    db_session.add(obj)
    await db_session.commit()
    await db_session.refresh(obj)
    return obj