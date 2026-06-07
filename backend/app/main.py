"""FastAPI application entry point."""

from fastapi import FastAPI, HTTPException, status

from app.config import settings
from app.database import check_database_connection
from app.routers import orders, outlets, products, reports, staff
from app.schemas.health import HealthRead

app = FastAPI(title=settings.app_name)

app.include_router(outlets.router, prefix="/api")
app.include_router(products.router, prefix="/api")
app.include_router(orders.router, prefix="/api")
app.include_router(staff.auth_router, prefix="/api")
app.include_router(staff.router, prefix="/api")
app.include_router(reports.router, prefix="/api")


@app.get("/health", response_model=HealthRead, tags=["health"])
async def health_check() -> HealthRead:
    """Return API and database health status."""
    if not await check_database_connection():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "error", "database": "disconnected"},
        )
    return HealthRead(status="ok", database="connected")


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    """Return a small API discovery response."""
    return {"name": settings.app_name, "health": "/health", "docs": "/docs"}