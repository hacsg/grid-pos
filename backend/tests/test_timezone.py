"""Grid operates in Singapore: store UTC, display SGT, and cut days on SGT midnight.

These guard the two ways that has gone wrong — a timestamp rendered without
being converted, and a "day" that means something different depending on which
module you ask.
"""

from datetime import date, datetime

from app.services.gto import sgt_day_bounds_utc as gto_day_bounds
from app.services.print_renderer import _receipt_time, _receipt_timestamp
from app.services.reports import _day_bounds as reports_day_bounds
from app.utils.timezone import SGT, UTC, business_day_bounds, sgt_day_bounds_utc, to_sgt


def test_to_sgt_shifts_by_eight_hours() -> None:
    utc = datetime(2026, 8, 7, 11, 23, 0, tzinfo=UTC)
    assert to_sgt(utc).hour == 19  # 11:23 UTC is 19:23 in Singapore


def test_to_sgt_treats_naive_as_utc() -> None:
    """A driver that drops the offset must not be read as server-local time."""
    naive = datetime(2026, 8, 7, 11, 23, 0)
    assert to_sgt(naive) == to_sgt(naive.replace(tzinfo=UTC))


def test_sgt_day_starts_at_16_00_utc_the_previous_day() -> None:
    start, end = sgt_day_bounds_utc(date(2026, 8, 7))
    assert (start.astimezone(UTC).hour, start.astimezone(UTC).day) == (16, 6)
    assert (end.astimezone(UTC).hour, end.astimezone(UTC).day) == (16, 7)
    assert start.astimezone(SGT).date() == date(2026, 8, 7)


def test_every_day_boundary_helper_agrees() -> None:
    """Reports used to cut on UTC midnight while the till and GTO cut on SGT.

    A report eight hours out of step with the Z-report and the landlord feed
    is the kind of disagreement nobody notices until the numbers are argued
    over, so pin them together.
    """
    day = date(2026, 8, 7)
    assert reports_day_bounds(day) == sgt_day_bounds_utc(day)
    assert gto_day_bounds(day) == sgt_day_bounds_utc(day)

    noon_sgt = datetime(2026, 8, 7, 4, 0, tzinfo=UTC)  # 12:00 SGT
    assert business_day_bounds(noon_sgt) == sgt_day_bounds_utc(day)


def test_business_day_of_a_late_evening_sale_is_that_same_sgt_day() -> None:
    """23:30 SGT is already the next UTC day — it must not roll the business day."""
    late = datetime(2026, 8, 7, 15, 30, tzinfo=UTC)  # 23:30 SGT on the 7th
    assert business_day_bounds(late) == sgt_day_bounds_utc(date(2026, 8, 7))


def test_receipt_prints_singapore_time() -> None:
    """Regression: receipts printed the UTC instant, eight hours behind."""
    order = {"createdAt": "2026-08-07T11:23:00.000Z"}  # 19:23 SGT
    assert _receipt_time(order) == "19:23"
    assert "7:23:00 PM" in _receipt_timestamp(order)
