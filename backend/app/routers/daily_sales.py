"""Protected cron endpoint for the previous day's daily sales email."""

from __future__ import annotations

import secrets
from datetime import date, timedelta

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.services.daily_sales_email import build_daily_sales_report, send_daily_sales_email
from app.utils.timezone import sgt_today

router = APIRouter(prefix="/daily-sales", tags=["daily-sales"])


def _require_cron_secret(value: str | None) -> None:
    expected = settings.daily_sales_cron_secret
    if not expected or not value or not secrets.compare_digest(value, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid cron secret")


@router.post("/send")
async def send_report(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    sales_date: date | None = Query(default=None, description="Override date (default: yesterday SGT)"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send the selected SGT day's report; skip quietly if every outlet is zero."""
    _require_cron_secret(x_cron_secret)
    target = sales_date or (sgt_today() - timedelta(days=1))
    dashboard, active_outlets, hourly = await build_daily_sales_report(db, target)
    if not active_outlets:
        return {"sales_date": target.isoformat(), "sent": False, "reason": "no_nonzero_sales"}
    try:
        email_id = await send_daily_sales_email(target, dashboard, active_outlets, hourly)
    except (httpx.HTTPError, RuntimeError, KeyError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {
        "sales_date": target.isoformat(),
        "sent": True,
        "email_id": email_id,
        "recipient": settings.daily_sales_report_to,
        "outlets": [outlet.outlet_name for outlet in active_outlets],
    }
