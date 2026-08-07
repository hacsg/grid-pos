"""Hourly GTO (gross turnover) file generation for the landlord/mall SFTP feed.

Implements the mall's "HOURLY POS INTERFACE SPECIFICATIONS VER 2.0": one text
file per sales date, 24 rows (hours 00-23), pipe-delimited, that the mall
ingests for GTO / rent calculations.

Row layout (18 fields), per the spec's sample files:

    MachineID | BatchID | DDMMYYYY | HH | ReceiptCount | GTO | GST | Discount
    | ServiceCharge | Pax | Cash | NETS | Visa | MasterCard | Amex | Voucher
    | Others | GSTRegistered(Y/N)

Field semantics (from the spec):
- GTO       = nett sales after discount, before GST (F&B includes service charge).
- Payment fields (Cash..Others) are each "after discount, before GST" and must
  sum to GTO for the hour.
- For a GST-registered tenant with GST-inclusive prices, GTO = total / (1+rate)
  and each payment bucket is likewise divided. HAC is not GST-registered
  (GST=0, GST Registered = N), so GTO = total and buckets are the raw amounts.

Hours and the sales date are in Singapore local time (the mall is in SGT).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gto_file import GtoFile
from app.models.order import Order, OrderStatus
from app.utils.timezone import SGT, UTC, sgt_day_bounds_utc
_CENTS = Decimal("0.01")

# Payment buckets in file-column order (fields 11-17).
PAYMENT_COLUMNS = ("cash", "nets", "visa", "mastercard", "amex", "voucher", "others")


def _q(value: Decimal) -> Decimal:
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


@dataclass
class HourRow:
    """Aggregated totals for a single hour (SGT)."""

    receipt_count: int = 0
    gto: Decimal = Decimal("0")
    gst: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    service_charge: Decimal = Decimal("0")
    pax: int = 0
    payments: dict[str, Decimal] = field(
        default_factory=lambda: {col: Decimal("0") for col in PAYMENT_COLUMNS}
    )


def _order_payment_split(order: Order) -> dict[str, Decimal]:
    """Attribute an order's total across payment buckets (sums to order.total).

    Grid captures per-leg amounts for split payments; single-method orders carry
    the whole total under payment_method. Card scheme (Visa/MC/Amex/NETS) is not
    captured from the terminal, so card and PayNow fall into 'Others'. CDC and
    Acre Group vouchers count as 'Voucher'.
    """
    buckets = {col: Decimal("0") for col in PAYMENT_COLUMNS}
    total = Decimal(str(order.total or 0))
    method = (order.payment_method or "").lower()

    if method == "split":
        cash = Decimal(str(order.cash_amount or 0))
        card = Decimal(str(order.card_amount or 0))
        voucher = Decimal(str(order.voucher_amount or 0)) + Decimal(str(order.cdc_amount or 0))
        buckets["cash"] += cash
        buckets["others"] += card
        buckets["voucher"] += voucher
        # Any residual (rounding / unattributed leg) lands in Others so the row
        # still balances to the order total.
        residual = total - (cash + card + voucher)
        if residual != 0:
            buckets["others"] += residual
    elif method == "cash":
        buckets["cash"] += total
    elif method == "voucher":
        buckets["voucher"] += total
    else:
        # card, paynow, or unknown → Others (scheme not captured)
        buckets["others"] += total
    return buckets


def aggregate_hours(
    orders: list[Order],
    *,
    gst_registered: bool = False,
    gst_rate: Decimal = Decimal("0.09"),
) -> list[HourRow]:
    """Build 24 HourRows (index 0..23 = SGT hour) from paid orders.

    For a GST-registered tenant with GST-inclusive prices, GTO and every payment
    bucket are divided by (1+rate) and the GST column carries the difference.
    """
    rows = [HourRow() for _ in range(24)]
    divisor = (Decimal("1") + gst_rate) if gst_registered else Decimal("1")

    for order in orders:
        created = order.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=ZoneInfo("UTC"))
        hour = created.astimezone(SGT).hour
        row = rows[hour]

        gross = Decimal(str(order.total or 0))  # after discount, GST-inclusive if registered
        subtotal = Decimal(str(order.subtotal or 0))
        discount = subtotal - gross
        if discount < 0:
            discount = Decimal("0")

        gto = gross / divisor
        gst = gross - gto

        row.receipt_count += 1
        row.gto += gto
        row.gst += gst
        row.discount += discount
        for col, amount in _order_payment_split(order).items():
            row.payments[col] += amount / divisor

    return rows


def format_date_ddmmyyyy(sales_date: date) -> str:
    return sales_date.strftime("%d%m%Y")


def gto_filename(machine_id: str, sales_date: date) -> str:
    """H<machine id>_YYYYMMDD.txt"""
    return f"H{machine_id}_{sales_date.strftime('%Y%m%d')}.txt"


def format_gto_file(
    *,
    machine_id: str,
    batch_id: int,
    sales_date: date,
    rows: list[HourRow],
    gst_registered: bool = False,
) -> str:
    """Render the 24-row, pipe-delimited file body (newline-separated)."""
    date_str = format_date_ddmmyyyy(sales_date)
    gst_flag = "Y" if gst_registered else "N"
    lines: list[str] = []
    for hour in range(24):
        row = rows[hour]
        fields = [
            machine_id,
            str(batch_id),
            date_str,
            f"{hour:02d}",
            str(row.receipt_count),
            f"{_q(row.gto):.2f}",
            f"{_q(row.gst):.2f}",
            f"{_q(row.discount):.2f}",
            f"{_q(row.service_charge):.2f}",
            str(row.pax),
            *[f"{_q(row.payments[col]):.2f}" for col in PAYMENT_COLUMNS],
            gst_flag,
        ]
        lines.append("|".join(fields))
    return "\r\n".join(lines) + "\r\n"


async def fetch_paid_orders_for_sgt_day(
    db: AsyncSession, sales_date: date, outlet_id=None
) -> list[Order]:
    """Load paid orders whose created_at falls within the SGT sales date."""
    start_utc, end_utc = sgt_day_bounds_utc(sales_date)
    stmt = select(Order).where(
        Order.status == OrderStatus.paid,
        Order.created_at >= start_utc,
        Order.created_at < end_utc,
    )
    if outlet_id is not None:
        stmt = stmt.where(Order.outlet_id == outlet_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def generate_and_store(
    db: AsyncSession,
    sales_date: date,
    *,
    machine_id: str,
    gst_registered: bool = False,
    gst_rate: Decimal = Decimal("0.09"),
    outlet_id=None,
) -> GtoFile:
    """Generate the GTO file for a sales date and upsert its backup record.

    Batch id is sequential and unique across dates, but stable for a given date:
    regenerating a date reuses its batch id (mall spec) and re-arms it for
    (re)upload. Always produces a full 24-row file, including a 0-sales day.
    """
    existing = await db.scalar(select(GtoFile).where(GtoFile.sales_date == sales_date))

    orders = await fetch_paid_orders_for_sgt_day(db, sales_date, outlet_id=outlet_id)
    rows = aggregate_hours(orders, gst_registered=gst_registered, gst_rate=gst_rate)

    if existing is not None:
        batch_id = existing.batch_id
    else:
        max_batch = await db.scalar(select(func.max(GtoFile.batch_id)))
        batch_id = (max_batch or 0) + 1

    content = format_gto_file(
        machine_id=machine_id,
        batch_id=batch_id,
        sales_date=sales_date,
        rows=rows,
        gst_registered=gst_registered,
    )
    filename = gto_filename(machine_id, sales_date)

    if existing is None:
        record = GtoFile(
            sales_date=sales_date,
            batch_id=batch_id,
            filename=filename,
            content=content,
            uploaded=False,
        )
        db.add(record)
    else:
        existing.filename = filename
        existing.content = content
        existing.uploaded = False
        existing.upload_error = None
        record = existing

    await db.commit()
    await db.refresh(record)
    return record
