"""GTO landlord-feed endpoints.

The mall requires the daily GTO file to be generated and transmitted at day
closing with no user intervention. Grid has no in-process scheduler, so a small
external Railway cron service calls POST /gto/close-day once per day (just after
midnight SGT) with the shared secret; that generates the previous SGT day's file
and flushes any unsent backlog. A 0-sales day still produces and sends a file.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.staff import Staff
from app.services import gto as gto_service
from app.services import gto_transmit
from app.utils.auth import get_current_staff

router = APIRouter(prefix="/gto", tags=["gto"])
from app.utils.timezone import SGT


def _require_cron_secret(x_cron_secret: str | None) -> None:
    expected = settings.gto_cron_secret
    if not expected or not x_cron_secret or not secrets.compare_digest(x_cron_secret, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid cron secret")


def _yesterday_sgt() -> date:
    return (datetime.now(SGT) - timedelta(days=1)).date()


async def _generate(db, sales_date: date):
    if not settings.gto_machine_id:
        raise HTTPException(status_code=503, detail="GTO_MACHINE_ID not configured")
    if settings.gto_outlet_id is None:
        raise HTTPException(status_code=503, detail="GTO_OUTLET_ID not configured")
    return await gto_service.generate_and_store(
        db,
        sales_date,
        machine_id=settings.gto_machine_id,
        gst_registered=settings.gto_gst_registered,
        gst_rate=Decimal(str(settings.gto_gst_rate)),
        outlet_id=settings.gto_outlet_id,
    )


@router.post("/close-day")
async def close_day(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    sales_date: date | None = Query(default=None, description="Override sales date (default: yesterday SGT)"),
) -> dict:
    """Cron entrypoint: generate the day's file and flush the unsent backlog."""
    _require_cron_secret(x_cron_secret)
    target = sales_date or _yesterday_sgt()
    async with AsyncSessionLocal() as db:
        record = await _generate(db, target)
        result = await gto_transmit.upload_pending(db)
        return {
            "sales_date": target.isoformat(),
            "filename": record.filename,
            "batch_id": record.batch_id,
            "uploaded": record.uploaded,
            "backlog": result,
        }


@router.post("/regenerate")
async def regenerate(
    sales_date: date = Query(..., description="SGT sales date to (re)generate"),
    current_staff: Staff = Depends(get_current_staff),
) -> dict:
    """Manually regenerate + resend a date (keeps the same batch id per spec)."""
    async with AsyncSessionLocal() as db:
        record = await _generate(db, sales_date)
        ok = await gto_transmit.upload_file(db, record)
        return {"filename": record.filename, "batch_id": record.batch_id, "uploaded": ok}


@router.get("/files")
async def list_files(
    current_staff: Staff = Depends(get_current_staff),
    limit: int = Query(default=30, ge=1, le=180),
) -> list[dict]:
    """Recent GTO files and their upload status (for an admin/ops view)."""
    from sqlalchemy import select

    from app.models.gto_file import GtoFile

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(select(GtoFile).order_by(GtoFile.sales_date.desc()).limit(limit))
        ).scalars().all()
        return [
            {
                "sales_date": r.sales_date.isoformat(),
                "filename": r.filename,
                "batch_id": r.batch_id,
                "uploaded": r.uploaded,
                "attempts": r.attempts,
                "upload_error": r.upload_error,
                "uploaded_at": r.uploaded_at.isoformat() if r.uploaded_at else None,
            }
            for r in rows
        ]


@router.get("/files/{sales_date}/preview")
async def preview_file(
    sales_date: date,
    current_staff: Staff = Depends(get_current_staff),
) -> dict:
    """Return the stored file body for inspection."""
    from sqlalchemy import select

    from app.models.gto_file import GtoFile

    async with AsyncSessionLocal() as db:
        record = await db.scalar(select(GtoFile).where(GtoFile.sales_date == sales_date))
        if record is None:
            raise HTTPException(status_code=404, detail="No GTO file for that date")
        return {"filename": record.filename, "content": record.content}
