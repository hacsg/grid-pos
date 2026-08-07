"""The one place that knows what timezone Grid operates in.

Grid runs in Singapore. Every timestamp is **stored** as an absolute instant in
UTC (all datetime columns are timestamptz) and **displayed** in SGT. Storing
local time instead would be the mistake it looks like a shortcut for: a naive
local timestamp cannot say which instant it means, and mixing naive and aware
values is what broke voucher redemption — asyncpg rejects an aware datetime
bound to a column the mapper declared naive.

So: convert at the edges, never in the middle. Read with :func:`now_utc`,
render with :func:`to_sgt`, and slice days with :func:`sgt_day_bounds_utc` so a
"day" means the same span to the till, the reports, and the landlord feed.

Before this module ``ZoneInfo("Asia/Singapore")`` was constructed in five places
under three names, and ``reports.py`` independently decided a day ran midnight
to midnight *UTC* — eight hours out from every other caller. Import from here.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

UTC = ZoneInfo("UTC")
SGT = ZoneInfo("Asia/Singapore")


def now_utc() -> datetime:
    """Current instant, timezone-aware, in UTC. Use this instead of datetime.now()."""
    return datetime.now(UTC)


def to_sgt(value: datetime) -> datetime:
    """Convert an instant to SGT for display.

    A naive value is assumed to be UTC: that is what the database hands back on
    drivers that drop the offset, and guessing the server's local zone instead
    would make output depend on where the container happens to run.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(SGT)


def sgt_day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """UTC bounds ``[start, end)`` spanning one SGT calendar day."""
    start_sgt = datetime.combine(day, time.min, tzinfo=SGT)
    return start_sgt.astimezone(UTC), (start_sgt + timedelta(days=1)).astimezone(UTC)


def sgt_today(now: datetime | None = None) -> date:
    """The current SGT calendar date."""
    return to_sgt(now or now_utc()).date()


def business_day_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """UTC bounds ``[start, end)`` for the SGT business day containing ``now``."""
    return sgt_day_bounds_utc(sgt_today(now))
