"""Run idempotent SQL migrations from the migrations/ directory on startup."""

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


async def run_sql_migrations() -> None:
    """Execute all .sql files in migrations/ in sorted order via asyncpg directly."""
    if not MIGRATIONS_DIR.is_dir():
        return

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        return

    import asyncpg

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        logger.warning("DATABASE_URL not set, skipping SQL migrations")
        return

    conn = await asyncpg.connect(database_url)
    try:
        for migration_file in migration_files:
            sql = migration_file.read_text(encoding="utf-8")
            logger.info("Running migration: %s", migration_file.name)
            await conn.execute(sql)
            logger.info("Migration completed: %s", migration_file.name)
    finally:
        await conn.close()
