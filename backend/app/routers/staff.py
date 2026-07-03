"""Staff authentication and management API routes.

Two routers are provided:

* ``auth_router`` (prefix ``/auth``) — login, token refresh, current-profile.
* ``router``        (prefix ``/staff``) — staff CRUD with role-based access.
"""

from collections import deque
from datetime import timedelta
from threading import Lock
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.outlet import Outlet
from app.models.staff import Staff, StaffRole
from app.schemas.staff import (
    PinResetRequest,
    StaffCreate,
    StaffLoginRequest,
    StaffRead,
    StaffRosterEntry,
    StaffUpdate,
    TokenRefreshResponse,
    TokenResponse,
)
from app.utils.auth import create_access_token, get_current_staff, require_role
from app.utils.hashing import hash_pin, verify_pin

# PIN login failures are kept in-process because Railway is currently deployed
# as a single worker. Move this to Redis before scaling beyond one worker.
_LOGIN_FAILURE_LIMIT = 5
_LOGIN_FAILURE_WINDOW_SECONDS = 5 * 60
_LOGIN_BLOCK_SECONDS = 10 * 60
_login_lock = Lock()
_login_failures: dict[str, deque[float]] = {}
_login_blocked_until: dict[str, float] = {}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


async def _load_staff_or_404(db: AsyncSession, staff_id: UUID) -> Staff:
    """Load a staff member by id or raise a 404 response."""
    staff = await db.get(Staff, staff_id)
    if staff is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found"
        )
    return staff


async def _ensure_outlet_exists(db: AsyncSession, outlet_id: UUID) -> None:
    """Validate that an outlet exists."""
    if await db.get(Outlet, outlet_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Outlet not found"
        )


def _login_rate_limit_key(request: Request, outlet_id: UUID | None) -> str:
    """Build an IP/outlet scoped key for PIN brute-force protection."""
    source_ip = request.client.host if request.client else "unknown"
    outlet_scope = str(outlet_id) if outlet_id is not None else "admin"
    return f"{outlet_scope}:{source_ip}"


def _prune_login_failures(attempts: deque[float], now: float) -> None:
    """Discard failures outside the rolling rate-limit window."""
    cutoff = now - _LOGIN_FAILURE_WINDOW_SECONDS
    while attempts and attempts[0] < cutoff:
        attempts.popleft()


def _enforce_login_rate_limit(key: str) -> None:
    """Raise 429 when the source is temporarily blocked."""
    now = monotonic()
    with _login_lock:
        blocked_until = _login_blocked_until.get(key)
        if blocked_until is not None:
            if blocked_until > now:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed login attempts. Try again later.",
                )
            _login_blocked_until.pop(key, None)

        attempts = _login_failures.get(key)
        if attempts is not None:
            _prune_login_failures(attempts, now)
            if not attempts:
                _login_failures.pop(key, None)


def _record_failed_login(key: str) -> None:
    """Record a failed login attempt and start a cooldown after the limit."""
    now = monotonic()
    with _login_lock:
        attempts = _login_failures.setdefault(key, deque())
        _prune_login_failures(attempts, now)
        attempts.append(now)
        if len(attempts) >= _LOGIN_FAILURE_LIMIT:
            _login_blocked_until[key] = now + _LOGIN_BLOCK_SECONDS


def _clear_failed_logins(key: str) -> None:
    """Clear failed login state after a successful login."""
    with _login_lock:
        _login_failures.pop(key, None)
        _login_blocked_until.pop(key, None)


def _invalid_credentials(key: str) -> HTTPException:
    """Record a failed login and return the standard auth failure."""
    _record_failed_login(key)
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


# ---------------------------------------------------------------------------
# Auth router  —  /api/auth/*
# ---------------------------------------------------------------------------

auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.get("/staff-roster", response_model=list[StaffRosterEntry])
async def staff_roster(
    outlet_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[StaffRosterEntry]:
    """Public roster of active staff at an outlet, for the POS login picker.

    Returns names only (no PINs/credentials) so the cashier can tap their name
    before entering a PIN.
    """
    result = await db.execute(
        select(Staff)
        .where(Staff.outlet_id == outlet_id, Staff.is_active.is_(True))
        .order_by(Staff.name)
    )
    return [
        StaffRosterEntry(id=staff.id, name=staff.name, role=staff.role.value)
        for staff in result.scalars().all()
    ]


@auth_router.post("/login", response_model=TokenResponse)
async def login_staff(
    payload: StaffLoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Authenticate a staff member.

    - If outlet_id provided: POS cashier flow — search by outlet + PIN.
    - If outlet_id NOT provided: admin flow — search by name + PIN across all outlets.
    """
    rate_limit_key = _login_rate_limit_key(request, payload.outlet_id)
    _enforce_login_rate_limit(rate_limit_key)

    if payload.outlet_id:
        # POS cashier flow: search by outlet + PIN, disambiguated by staff name
        # when provided (a bare PIN can collide between staff at the same outlet).
        query = select(Staff).where(
            Staff.outlet_id == payload.outlet_id, Staff.is_active.is_(True)
        )
        if payload.name:
            query = query.where(Staff.name.ilike(payload.name.strip()))
    else:
        # Admin flow: search by name + PIN across all outlets
        if not payload.name:
            raise _invalid_credentials(rate_limit_key)
        query = select(Staff).where(
            Staff.name.ilike(f"%{payload.name}%"), Staff.is_active.is_(True)
        )

    result = await db.execute(query)
    staff_members = list(result.scalars().all())

    matched = None
    for staff in staff_members:
        if verify_pin(payload.pin, staff.pin_hash):
            matched = staff
            break

    if matched is None:
        raise _invalid_credentials(rate_limit_key)

    _clear_failed_logins(rate_limit_key)

    token = create_access_token(
        subject=matched.id,
        role=matched.role.value,
        outlet_id=matched.outlet_id,
        expires_delta=timedelta(seconds=settings.access_token_expire_minutes * 60),
    )
    return TokenResponse(
        access_token=token,
        staff=matched,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@auth_router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh_token(
    current_staff: Staff = Depends(get_current_staff),
) -> TokenRefreshResponse:
    """Issue a new JWT with extended expiry from an existing valid token."""
    token = create_access_token(
        subject=current_staff.id,
        role=current_staff.role.value,
        outlet_id=current_staff.outlet_id,
    )
    return TokenRefreshResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@auth_router.get("/me", response_model=StaffRead)
async def get_my_profile(
    current_staff: Staff = Depends(get_current_staff),
) -> Staff:
    """Return the currently authenticated staff member's profile."""
    return current_staff


# ---------------------------------------------------------------------------
# Staff management router  —  /api/staff/*
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/staff", tags=["staff"])


@router.get("", response_model=list[StaffRead])
async def list_staff(
    outlet_id: UUID | None = None,
    role: StaffRole | None = None,
    is_active: bool | None = None,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> list[Staff]:
    """List staff members with optional filters.

    Role restrictions:
    * **cashier** — only sees themselves.
    * **supervisor, manager** — only staff in their own outlet.
    * **admin** — all staff across outlets.
    """
    statement = select(Staff)

    # Role-based scoping
    if current_staff.role == StaffRole.cashier:
        statement = statement.where(Staff.id == current_staff.id)
    elif current_staff.role in (StaffRole.supervisor, StaffRole.manager):
        statement = statement.where(Staff.outlet_id == current_staff.outlet_id)

    # Optional querystring filters
    if outlet_id is not None:
        statement = statement.where(Staff.outlet_id == outlet_id)
    if role is not None:
        statement = statement.where(Staff.role == role)
    if is_active is not None:
        statement = statement.where(Staff.is_active.is_(is_active))

    statement = statement.order_by(Staff.name)
    result = await db.execute(statement)
    return list(result.scalars().all())


@router.get("/{staff_id}", response_model=StaffRead)
async def get_staff(
    staff_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
) -> Staff:
    """Return one staff member by id.

    * **cashier** — own profile only.
    * **supervisor, manager** — own outlet only.
    * **admin** — any staff member.
    """
    staff = await _load_staff_or_404(db, staff_id)

    if current_staff.role == StaffRole.cashier and staff.id != current_staff.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )
    if current_staff.role in (StaffRole.supervisor, StaffRole.manager):
        if staff.outlet_id != current_staff.outlet_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
    return staff


@router.post("", response_model=StaffRead, status_code=status.HTTP_201_CREATED)
async def create_staff(
    payload: StaffCreate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager)),
) -> Staff:
    """Create a new staff member (admin or manager).

    **Manager** restriction: can only create staff in their own outlet.
    """
    if current_staff.role == StaffRole.manager and payload.outlet_id != current_staff.outlet_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Managers can only create staff in their own outlet",
        )

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


@router.put("/{staff_id}", response_model=StaffRead)
async def update_staff(
    staff_id: UUID,
    payload: StaffUpdate,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin, StaffRole.manager)),
) -> Staff:
    """Update staff profile (admin or manager).

    * PIN cannot be changed via this endpoint — use ``reset-pin`` instead.
    * **Manager** restriction: can only update staff in their own outlet.
    """
    staff = await _load_staff_or_404(db, staff_id)

    if current_staff.role == StaffRole.manager and staff.outlet_id != current_staff.outlet_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Managers can only update staff in their own outlet",
        )

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return staff

    if "outlet_id" in update_data:
        await _ensure_outlet_exists(db, update_data["outlet_id"])

    for field, value in update_data.items():
        setattr(staff, field, value)
    await db.commit()
    await db.refresh(staff)
    return staff


@router.post("/{staff_id}/reset-pin", response_model=StaffRead)
async def reset_staff_pin(
    staff_id: UUID,
    payload: PinResetRequest,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(
        require_role(StaffRole.admin, StaffRole.manager)
    ),
) -> Staff:
    """Reset a staff member's PIN (admin or manager).

    **Manager** restriction: can only reset PIN for own outlet staff.
    """
    staff = await _load_staff_or_404(db, staff_id)

    if current_staff.role == StaffRole.manager and staff.outlet_id != current_staff.outlet_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Managers can only reset PIN for staff in their own outlet",
        )

    staff.pin_hash = hash_pin(payload.new_pin)
    await db.commit()
    await db.refresh(staff)
    return staff


@router.delete("/{staff_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_staff(
    staff_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_staff: Staff = Depends(require_role(StaffRole.admin)),
) -> Response:
    """Deactivate a staff member (admin only)."""
    staff = await _load_staff_or_404(db, staff_id)
    staff.is_active = False
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
