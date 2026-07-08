"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import check_database_connection
from app.migrations import run_sql_migrations
from app.routers import campaigns, customers, discounts, gto, kpay, loyalty, orders, outlets, products, reports, shift, staff, till, vouchers, ws_daemon
from app.schemas.health import HealthRead


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Run SQL migrations before serving requests.

    Card payments use a synchronous request/response to the Go daemon
    (POST /api/kpay/start blocks until the terminal returns a result), so no
    background polling loop is required.
    """
    await run_sql_migrations()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(outlets.router, prefix="/api")
app.include_router(products.router, prefix="/api")
app.include_router(orders.router, prefix="/api")
app.include_router(staff.auth_router, prefix="/api")
app.include_router(staff.router, prefix="/api")
app.include_router(shift.router, prefix="/api")
app.include_router(loyalty.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(vouchers.router, prefix="/api")
app.include_router(campaigns.router, prefix="/api")
app.include_router(customers.router, prefix="/api")
app.include_router(discounts.router, prefix="/api")
app.include_router(kpay.router, prefix="/api/kpay", tags=["kpay"])
app.include_router(gto.router, prefix="/api")
app.include_router(till.router, prefix="/api")
app.include_router(ws_daemon.router, tags=["websocket"])


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
