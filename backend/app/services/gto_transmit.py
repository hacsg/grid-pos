"""FTP/SFTP transmission of GTO files, with retry of any unsent backlog.

The vendor endpoint determines which transport is used. Transfers run in a
worker thread because both ftplib and Paramiko are synchronous. Every generated
file is persisted before upload is attempted, so a failed transmission never
loses data and is retried on the next run.
"""

from __future__ import annotations

import asyncio
from ftplib import FTP
from io import BytesIO
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.gto_file import GtoFile

logger = logging.getLogger(__name__)


class TransferNotConfigured(RuntimeError):
    pass


def _require_transfer_config() -> None:
    if not settings.gto_sftp_host or not settings.gto_sftp_username:
        raise TransferNotConfigured("GTO transfer host/username not configured")


def _upload_ftp(filename: str, content: str) -> None:
    """Upload using the vendor's legacy plain-FTP endpoint."""
    _require_transfer_config()
    with FTP() as ftp:
        ftp.connect(settings.gto_sftp_host, settings.gto_sftp_port, timeout=30)
        ftp.login(settings.gto_sftp_username, settings.gto_sftp_password)
        remote_dir = settings.gto_sftp_remote_dir or "."
        if remote_dir not in ("", "."):
            ftp.cwd(remote_dir)
        ftp.storbinary(f"STOR {filename}", BytesIO(content.encode("utf-8")))


def _upload_sftp(filename: str, content: str) -> None:
    """Upload using SFTP."""
    import paramiko  # imported lazily so the app boots without paramiko in dev

    _require_transfer_config()
    transport = paramiko.Transport((settings.gto_sftp_host, settings.gto_sftp_port))
    try:
        transport.connect(username=settings.gto_sftp_username, password=settings.gto_sftp_password)
        sftp = paramiko.SFTPClient.from_transport(transport)
        assert sftp is not None
        remote_dir = settings.gto_sftp_remote_dir or "."
        remote_path = f"{remote_dir.rstrip('/')}/{filename}"
        with sftp.open(remote_path, "w") as remote:
            remote.write(content)
        sftp.close()
    finally:
        transport.close()


def _upload_blocking(filename: str, content: str) -> None:
    """Open the configured transfer session and write one file."""
    protocol = settings.gto_transfer_protocol.strip().lower()
    if protocol == "ftp":
        _upload_ftp(filename, content)
    elif protocol == "sftp":
        _upload_sftp(filename, content)
    else:
        raise TransferNotConfigured(f"Unsupported GTO transfer protocol: {protocol}")


async def upload_file(db: AsyncSession, record: GtoFile) -> bool:
    """Attempt to upload one GtoFile; persist the outcome. Returns success."""
    record.attempts += 1
    try:
        await asyncio.to_thread(_upload_blocking, record.filename, record.content)
    except Exception as exc:  # noqa: BLE001 - record and retry later
        record.upload_error = str(exc)[:500]
        await db.commit()
        logger.warning("GTO upload failed for %s: %s", record.filename, exc)
        return False

    from datetime import datetime, timezone

    record.uploaded = True
    record.upload_error = None
    record.uploaded_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info("GTO uploaded: %s", record.filename)
    return True


async def upload_pending(db: AsyncSession, limit: int = 60) -> dict[str, int]:
    """Upload every not-yet-sent file (oldest first). Used to clear a backlog
    that built up while SFTP was unreachable."""
    pending = (
        await db.execute(
            select(GtoFile).where(GtoFile.uploaded.is_(False)).order_by(GtoFile.sales_date).limit(limit)
        )
    ).scalars().all()

    sent, failed = 0, 0
    for record in pending:
        if await upload_file(db, record):
            sent += 1
        else:
            failed += 1
            # Stop hammering a down server; the rest stay pending for next run.
            break
    return {"pending": len(pending), "sent": sent, "failed": failed}
