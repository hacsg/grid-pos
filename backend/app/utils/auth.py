"""JWT authentication helpers and FastAPI dependencies."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.staff import Staff

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/staff/login")


def create_access_token(subject: UUID, expires_delta: timedelta | None = None) -> str:
    """Create a signed JWT access token for a staff member."""
    expires_at = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = {"sub": str(subject), "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


async def get_current_staff(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Staff:
    """Return the active staff member referenced by a bearer token."""
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        subject = payload.get("sub")
        if subject is None:
            raise credentials_error
        staff_id = UUID(subject)
    except (JWTError, ValueError) as exc:
        raise credentials_error from exc

    staff = await db.get(Staff, staff_id)
    if staff is None or not staff.is_active:
        raise credentials_error
    return staff

