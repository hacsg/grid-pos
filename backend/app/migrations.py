"""Run SQL migrations from the migrations/ directory on startup, once each.

A ``schema_migrations`` ledger records which files have already been applied so
each migration runs exactly once, even across redeploys. Before this ledger
existed the runner re-executed every file on every boot, which silently
duplicated any non-idempotent statement (notably the seed ``INSERT``s) on each
deploy. Each file is applied and recorded atomically in a single transaction.
"""

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

_LEDGER_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


def _asyncpg_dsn(database_url: str) -> str:
    """Strip SQLAlchemy's ``+asyncpg`` driver suffix; asyncpg wants a bare DSN."""
    return database_url.replace("+asyncpg", "", 1)


async def run_sql_migrations() -> None:
    """Apply any migrations/*.sql files not yet recorded in the ledger, in order."""
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

    conn = await asyncpg.connect(_asyncpg_dsn(database_url))
    try:
        await conn.execute(_LEDGER_DDL)
        applied = {
            row["filename"]
            for row in await conn.fetch("SELECT filename FROM schema_migrations")
        }

        for migration_file in migration_files:
            name = migration_file.name
            if name in applied:
                logger.debug("Skipping already-applied migration: %s", name)
                continue

            sql = migration_file.read_text(encoding="utf-8")
            logger.info("Running migration: %s", name)
            # Apply the migration and record it atomically: if the SQL fails the
            # ledger row is rolled back too, so it retries on the next boot.
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)", name
                )
            logger.info("Migration completed: %s", name)
    finally:
        await conn.close()
