"""GTO file-format tests, checked against the mall spec's sample files."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.services.gto import (
    HourRow,
    PAYMENT_COLUMNS,
    aggregate_hours,
    format_gto_file,
    gto_filename,
    sgt_day_bounds_utc,
)

UTC = ZoneInfo("UTC")


def _order(total, subtotal=None, method="cash", hour_sgt=14, **kw):
    """A minimal Order-like stub for aggregation (created_at in SGT hour)."""
    created = datetime(2016, 1, 23, hour_sgt, 5, tzinfo=ZoneInfo("Asia/Singapore")).astimezone(UTC)
    return SimpleNamespace(
        total=Decimal(str(total)),
        subtotal=Decimal(str(subtotal if subtotal is not None else total)),
        payment_method=method,
        cash_amount=kw.get("cash_amount"),
        card_amount=kw.get("card_amount"),
        voucher_amount=kw.get("voucher_amount"),
        cdc_amount=kw.get("cdc_amount"),
        created_at=created,
    )


def test_filename_format():
    assert gto_filename("12345678", date(2016, 1, 23)) == "H12345678_20160123.txt"


def test_zero_sales_day_is_24_zero_rows():
    rows = [HourRow() for _ in range(24)]
    body = format_gto_file(
        machine_id="12345678", batch_id=1, sales_date=date(2016, 1, 23), rows=rows,
        gst_registered=False,
    )
    lines = body.strip("\r\n").split("\r\n")
    assert len(lines) == 24
    # Hour 00 row, all zeros, GST-registered = N (HAC).
    assert lines[0] == "12345678|1|23012016|00|0|0.00|0.00|0.00|0.00|0|0.00|0.00|0.00|0.00|0.00|0.00|0.00|N"
    # Hours are zero-padded 00..23.
    assert lines[23].split("|")[3] == "23"


def test_hac_not_gst_registered_row():
    # HAC: not GST-registered → GTO = total, GST = 0, buckets = raw amounts.
    # One cash sale of $9.35 and one card sale of $12.65 at 14:00, $10 discount total.
    orders = [
        _order("9.35", subtotal="14.35", method="cash", hour_sgt=14),
        _order("12.65", subtotal="17.65", method="card", hour_sgt=14),
    ]
    rows = aggregate_hours(orders, gst_registered=False)
    r = rows[14]
    assert r.receipt_count == 2
    assert r.gto == Decimal("22.00")
    assert r.gst == Decimal("0")
    assert r.discount == Decimal("10.00")
    assert r.payments["cash"] == Decimal("9.35")
    assert r.payments["others"] == Decimal("12.65")
    # Payment buckets sum to GTO.
    assert sum(r.payments.values()) == r.gto


def test_split_payment_attribution():
    # Split: cash 5 + card 4 + cdc voucher 3 = 12 total.
    orders = [
        _order(
            "12.00", subtotal="12.00", method="split", hour_sgt=10,
            cash_amount="5.00", card_amount="4.00", cdc_amount="3.00",
        )
    ]
    rows = aggregate_hours(orders, gst_registered=False)
    r = rows[10]
    assert r.payments["cash"] == Decimal("5.00")
    assert r.payments["others"] == Decimal("4.00")
    assert r.payments["voucher"] == Decimal("3.00")
    assert sum(r.payments.values()) == r.gto == Decimal("12.00")


def test_gst_registered_strips_gst_like_spec_retail_sample():
    # Retail spec sample: Total Payment 33.18 GTO after /1.07... but the spec's
    # retail example uses 7%. Verify the divide-by-(1+rate) mechanics with 7%.
    orders = [_order("35.50", subtotal="45.50", method="nets", hour_sgt=12)]
    # payment_method 'nets' isn't a grid method; treat as others here — the point
    # is the GST math, checked on the GTO/GST split.
    rows = aggregate_hours(orders, gst_registered=True, gst_rate=Decimal("0.07"))
    r = rows[12]
    assert r.gto == Decimal("35.50") / Decimal("1.07")
    # GTO quantized matches the spec's 33.18.
    assert format_gto_file(
        machine_id="1", batch_id=1, sales_date=date(2016, 2, 2), rows=rows, gst_registered=True
    ).split("\r\n")[12].split("|")[5] == "33.18"


def test_sgt_hour_bucketing_across_utc_midnight():
    # 00:30 SGT = 16:30 UTC previous day. Must bucket into SGT hour 0.
    o = _order("5.00", method="cash", hour_sgt=0)
    rows = aggregate_hours([o], gst_registered=False)
    assert rows[0].receipt_count == 1
    assert rows[1].receipt_count == 0


def test_sgt_day_bounds_are_utc_minus_8():
    start, end = sgt_day_bounds_utc(date(2026, 7, 7))
    # SGT midnight 2026-07-07 == 2026-07-06 16:00 UTC.
    assert start == datetime(2026, 7, 6, 16, 0, tzinfo=UTC)
    assert end == datetime(2026, 7, 7, 16, 0, tzinfo=UTC)


def test_all_payment_columns_present_and_ordered():
    assert PAYMENT_COLUMNS == ("cash", "nets", "visa", "mastercard", "amex", "voucher", "others")


# --- DB integration: batch-id stability + generation --------------------------
import pytest
from datetime import datetime as _dt, timezone as _tz
from app.models.order import Order, OrderStatus
from app.models.outlet import Outlet
from app.services.gto import generate_and_store


async def _paid_order(db, outlet, staff, *, total, subtotal, method, when_utc):
    o = Order(
        order_number=f"T{when_utc.timestamp():.0f}"[-12:],
        outlet_id=outlet.id,
        staff_id=staff.id,
        subtotal=subtotal,
        total=total,
        status=OrderStatus.paid,
        payment_method=method,
        created_at=when_utc,
    )
    db.add(o)
    await db.commit()
    return o


@pytest.mark.asyncio
async def test_generate_and_store_filters_to_configured_outlet(
    db_session, outlet, cashier_staff
):
    from datetime import date as _date
    from decimal import Decimal as D

    other_outlet = Outlet(name="Other Outlet", address="Elsewhere")
    db_session.add(other_outlet)
    await db_session.commit()
    await db_session.refresh(other_outlet)

    when = _dt(2026, 7, 20, 2, 5, tzinfo=_tz.utc)
    await _paid_order(
        db_session, outlet, cashier_staff,
        total=D("9.35"), subtotal=D("9.35"), method="cash", when_utc=when,
    )
    await _paid_order(
        db_session, other_outlet, cashier_staff,
        total=D("50.00"), subtotal=D("50.00"), method="cash",
        when_utc=when + timedelta(seconds=1),
    )

    record = await generate_and_store(
        db_session,
        _date(2026, 7, 20),
        machine_id="12345678",
        outlet_id=outlet.id,
    )

    hour = record.content.split("\r\n")[10].split("|")
    assert hour[4] == "1"
    assert hour[5] == "9.35"


@pytest.mark.asyncio
async def test_generate_and_store_batch_id_is_stable(db_session, outlet, cashier_staff):
    from decimal import Decimal as D
    # 2026-07-07 10:05 SGT == 02:05 UTC.
    when = _dt(2026, 7, 7, 2, 5, tzinfo=_tz.utc)
    await _paid_order(db_session, outlet, cashier_staff, total=D("9.35"), subtotal=D("9.35"), method="cash", when_utc=when)

    from datetime import date as _date
    rec1 = await generate_and_store(db_session, _date(2026, 7, 7), machine_id="12345678")
    assert rec1.batch_id == 1
    assert rec1.filename == "H12345678_20260707.txt"
    assert "|10|1|9.35|0.00|0.00|0.00|0|9.35|" in rec1.content  # hour 10, 1 receipt, cash 9.35

    # A different date gets the next sequential batch id.
    rec2 = await generate_and_store(db_session, _date(2026, 7, 8), machine_id="12345678")
    assert rec2.batch_id == 2

    # Regenerating the first date keeps its batch id and re-arms upload.
    rec1b = await generate_and_store(db_session, _date(2026, 7, 7), machine_id="12345678")
    assert rec1b.batch_id == 1
    assert rec1b.uploaded is False
