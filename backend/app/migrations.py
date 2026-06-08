"""Run idempotent SQL migrations from the migrations/ directory on startup."""

import logging
from pathlib import Path

from sqlalchemy import text

from app.database import engine

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


async def run_sql_migrations() -> None:
    """Execute all .sql files in migrations/ in sorted order."""
    if not MIGRATIONS_DIR.is_dir():
        return

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        return

    async with engine.begin() as connection:
        for migration_file in migration_files:
            sql = migration_file.read_text(encoding="utf-8")
            logger.info("Running migration: %s", migration_file.name)
            await connection.execute(text(sql))