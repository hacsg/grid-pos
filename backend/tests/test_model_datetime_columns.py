"""Every datetime column must be timezone-aware.

The app writes timestamps as ``datetime.now(UTC)``. A ``mapped_column`` that
omits an explicit type lets SQLAlchemy infer a naive ``DateTime()`` from the
annotation — asyncpg then binds it with the naive-timestamp codec and the write
fails with "can't subtract offset-naive and offset-aware datetimes", regardless
of the column being timestamptz in Postgres.

SQLite does not care about any of this, so no functional test catches it. This
asserts the invariant on the mapper itself, which does.

Voucher.redeemed_at / expires_at / voided_at were declared bare, so voucher
redemption 500'd on every attempt from the day the feature shipped.
"""

from sqlalchemy import DateTime

import app.models  # noqa: F401  — registers every model on Base.metadata
from app.database import Base


def test_all_datetime_columns_are_timezone_aware() -> None:
    naive = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.sorted_tables
        for column in table.columns
        if isinstance(column.type, DateTime) and not column.type.timezone
    ]
    assert naive == [], (
        "timezone-naive datetime columns will fail on write under asyncpg; "
        f"declare DateTime(timezone=True) on: {', '.join(naive)}"
    )
