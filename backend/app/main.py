"""FastAPI application entry point."""

from contextlib import asynccontextmanager
import logging
import secrets

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings
from app.database import check_database_connection
from app.migrations import run_sql_migrations
from app.routers import analytics, campaigns, customers, daily_sales, discounts, gto, kpay, loyalty, orders, outlets, print_templates, products, reports, shift, staff, till, vouchers, ws_daemon
from app.schemas.health import HealthRead

logger = logging.getLogger(__name__)


class UnhandledExceptionMiddleware(BaseHTTPMiddleware):
    """Return a CORS-safe JSON 500 for unhandled exceptions.

    Starlette's ServerErrorMiddleware sits outside user middleware. If an
    exception reaches it, the plain 500 never passes back through CORS and the
    browser surfaces a "Network Error". Catching here (inside CORSMiddleware)
    keeps the response readable by the till client.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        try:
            return await call_next(request)
        except Exception:
            ref = secrets.token_hex(3).upper()
            logger.exception("Unhandled server error Ref: %s", ref)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "detail": (
                        "Something went wrong on our side. Don't retry — "
                        f"this order may already exist. Ref: {ref}"
                    ),
                },
            )


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

# add_middleware inserts at position 0: last added is outermost. Register the
# unhandled-exception handler *before* CORS so it sits inside CORSMiddleware.
app.add_middleware(UnhandledExceptionMiddleware)
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
app.include_router(analytics.router, prefix="/api")
app.include_router(daily_sales.router, prefix="/api")
app.include_router(vouchers.router, prefix="/api")
app.include_router(campaigns.router, prefix="/api")
app.include_router(customers.router, prefix="/api")
app.include_router(discounts.router, prefix="/api")
app.include_router(print_templates.router, prefix="/api")
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
