"""SFTP transmission of GTO files, with retry of any unsent backlog.

Paramiko is synchronous, so uploads run in a worker thread. Every generated
file is persisted (gto_files.content) before upload is attempted, so a failed
transmission never loses data — the file is retried on the next run (mall spec:
store pending/missed data and resend once the connection is restored).
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.gto_file import GtoFile

logger = logging.getLogger(__name__)


class SftpNotConfigured(RuntimeError):
    pass


def _upload_blocking(filename: str, content: str) -> None:
    """Open an SFTP session and write one file. Runs in a worker thread."""
    import paramiko  # imported lazily so the app boots without paramiko in dev

    if not settings.gto_sftp_host or not settings.gto_sftp_username:
        raise SftpNotConfigured("GTO SFTP host/username not configured")

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
