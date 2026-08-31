"""Build and deliver the previous SGT day's dashboard as an email."""

from __future__ import annotations

import base64
from datetime import date
from email.message import EmailMessage
from html import escape
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.order import Order, OrderStatus
from app.schemas.analytics import AnalyticsDashboardResponse, OutletSalesItem
from app.services.analytics import get_analytics_dashboard
from app.utils.timezone import sgt_day_bounds_utc, to_sgt


def _money(value: float) -> str:
    return f"S${value:,.2f}"


def _hour_label(hour: int) -> str:
    return f"{hour:02d}:00–{(hour + 1) % 24:02d}:00"


async def _hourly_by_outlet(
    db: AsyncSession, sales_date: date, active_outlet_ids: set[UUID]
) -> dict[UUID, list[float]]:
    """Return 24 SGT hourly sales buckets for each outlet included in the email."""
    if not active_outlet_ids:
        return {}
    start, end = sgt_day_bounds_utc(sales_date)
    orders = (
        await db.execute(
            select(Order).where(
                Order.status == OrderStatus.paid,
                Order.created_at >= start,
                Order.created_at < end,
                Order.outlet_id.in_(active_outlet_ids),
            )
        )
    ).scalars().all()
    buckets = {outlet_id: [0.0] * 24 for outlet_id in active_outlet_ids}
    for order in orders:
        buckets[order.outlet_id][to_sgt(order.created_at).hour] += float(order.total or 0)
    return buckets


async def build_daily_sales_report(
    db: AsyncSession, sales_date: date
) -> tuple[AnalyticsDashboardResponse, list[OutletSalesItem], dict[UUID, list[float]]]:
    """Load the dashboard and retain only outlets whose net sales are non-zero."""
    dashboard = await get_analytics_dashboard(db, from_date=sales_date, to_date=sales_date)
    active_outlets = [outlet for outlet in dashboard.sales_by_outlet if outlet.net_sales != 0]
    active_ids = {UUID(outlet.outlet_id) for outlet in active_outlets}
    hourly = await _hourly_by_outlet(db, sales_date, active_ids)
    return dashboard, active_outlets, hourly


def render_daily_sales_html(
    sales_date: date,
    dashboard: AnalyticsDashboardResponse,
    active_outlets: list[OutletSalesItem],
    hourly_by_outlet: dict[UUID, list[float]],
) -> str:
    """Render an email-safe HTML report with outlet totals first."""
    outlet_cards = "".join(
        f'<td style="padding:8px"><div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;min-width:150px">'
        f'<div style="font-size:12px;color:#6b7280">{escape(outlet.outlet_name)}</div>'
        f'<div style="font-size:24px;font-weight:700;margin-top:4px">{_money(outlet.net_sales)}</div>'
        f'<div style="font-size:12px;color:#6b7280;margin-top:4px">{outlet.transactions:,} transactions</div></div></td>'
        for outlet in active_outlets
    )
    outlet_headers = "".join(
        f'<th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">{escape(o.outlet_name)}</th>'
        for o in active_outlets
    )
    hourly_rows = []
    for hour in range(24):
        values = [hourly_by_outlet[UUID(o.outlet_id)][hour] for o in active_outlets]
        cells = "".join(
            f'<td style="text-align:right;padding:8px;border-bottom:1px solid #f3f4f6">{_money(value)}</td>'
            for value in values
        )
        hourly_rows.append(
            f'<tr><td style="padding:8px;border-bottom:1px solid #f3f4f6">{_hour_label(hour)}</td>'
            f'{cells}<td style="text-align:right;padding:8px;border-bottom:1px solid #f3f4f6;font-weight:600">{_money(sum(values))}</td></tr>'
        )

    payments = "".join(
        f'<tr><td style="padding:7px">{escape(item.method)}</td><td style="padding:7px;text-align:right">{_money(item.amount)}</td></tr>'
        for item in dashboard.payments
        if item.amount != 0
    )
    products = "".join(
        f'<tr><td style="padding:7px">{index}</td><td style="padding:7px">{escape(item.name)}</td>'
        f'<td style="padding:7px;text-align:right">{item.quantity:,}</td><td style="padding:7px;text-align:right">{_money(item.revenue)}</td></tr>'
        for index, item in enumerate(dashboard.top_by_revenue, 1)
    )
    kpis = dashboard.kpis
    report_date = sales_date.strftime("%A, %d %B %Y")
    return f"""<!doctype html>
<html><body style="margin:0;background:#f5f5f4;color:#1c1917;font-family:Arial,sans-serif">
<div style="max-width:900px;margin:auto;padding:24px">
  <div style="background:#fff;border-radius:14px;padding:28px">
    <div style="font-size:12px;color:#78716c;letter-spacing:.08em;text-transform:uppercase">Grid POS · Daily sales</div>
    <h1 style="font-size:26px;margin:6px 0">{escape(report_date)}</h1>
    <p style="color:#78716c;margin:0 0 18px">All figures use Singapore time (SGT). Outlets with zero sales are omitted.</p>
    <h2 style="font-size:17px;margin:24px 0 8px">Sales by outlet</h2>
    <table role="presentation" style="border-collapse:collapse"><tr>{outlet_cards}</tr></table>
    <h2 style="font-size:17px;margin:28px 0 8px">Group overview</h2>
    <table style="width:100%;border-collapse:collapse;background:#fafaf9">
      <tr><td style="padding:12px">Net sales<br><strong>{_money(kpis.net_sales)}</strong></td>
      <td style="padding:12px">Gross sales<br><strong>{_money(kpis.gross_sales)}</strong></td>
      <td style="padding:12px">Transactions<br><strong>{kpis.transactions:,}</strong></td>
      <td style="padding:12px">Items sold<br><strong>{kpis.items_sold:,}</strong></td>
      <td style="padding:12px">Average ticket<br><strong>{_money(kpis.avg_ticket)}</strong></td></tr>
    </table>
    <h2 style="font-size:17px;margin:28px 0 8px">Hourly earnings by outlet</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb">Hour (SGT)</th>{outlet_headers}<th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">Total</th></tr></thead>
      <tbody>{''.join(hourly_rows)}</tbody>
    </table>
    <table role="presentation" style="width:100%;margin-top:24px"><tr><td style="width:48%;vertical-align:top">
      <h2 style="font-size:17px">Payment mix</h2><table style="width:100%;border-collapse:collapse">{payments}</table>
    </td><td style="width:4%"></td><td style="width:48%;vertical-align:top">
      <h2 style="font-size:17px">Redemptions</h2>
      <p>CDC: <strong>{_money(dashboard.redemptions.cdc.value)}</strong> ({dashboard.redemptions.cdc.orders:,} orders)</p>
      <p>Vouchers: <strong>{_money(dashboard.redemptions.vouchers.value)}</strong> ({dashboard.redemptions.vouchers.count:,} redemptions)</p>
    </td></tr></table>
    <h2 style="font-size:17px;margin:28px 0 8px">Top products by revenue</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th></th><th style="text-align:left">Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody>{products}</tbody></table>
  </div>
</div></body></html>"""


def render_daily_sales_text(
    sales_date: date,
    dashboard: AnalyticsDashboardResponse,
    active_outlets: list[OutletSalesItem],
    hourly_by_outlet: dict[UUID, list[float]],
) -> str:
    """Plain-text fallback for mail clients that do not render HTML."""
    lines = [f"GRID POS DAILY SALES — {sales_date.isoformat()} (SGT)", "", "SALES BY OUTLET"]
    lines.extend(f"{o.outlet_name}: {_money(o.net_sales)} ({o.transactions} transactions)" for o in active_outlets)
    lines.extend(["", f"Group net sales: {_money(dashboard.kpis.net_sales)}", f"Transactions: {dashboard.kpis.transactions}", "", "HOURLY EARNINGS"])
    for hour in range(24):
        parts = [f"{o.outlet_name}: {_money(hourly_by_outlet[UUID(o.outlet_id)][hour])}" for o in active_outlets]
        lines.append(f"{_hour_label(hour)}  " + " | ".join(parts))
    return "\n".join(lines)


async def send_daily_sales_email(
    sales_date: date,
    dashboard: AnalyticsDashboardResponse,
    active_outlets: list[OutletSalesItem],
    hourly_by_outlet: dict[UUID, list[float]],
) -> str:
    """Refresh the Pallino Gmail OAuth grant and send an RFC 2822 message."""
    if not all(
        (
            settings.gmail_api_client_id,
            settings.gmail_api_client_secret,
            settings.gmail_api_refresh_token,
            settings.daily_sales_report_from,
        )
    ):
        raise RuntimeError(
            "GMAIL_API_CLIENT_ID, GMAIL_API_CLIENT_SECRET, "
            "GMAIL_API_REFRESH_TOKEN and DAILY_SALES_REPORT_FROM must be configured"
        )
    recipients = [address.strip() for address in settings.daily_sales_report_to.split(",") if address.strip()]
    if not recipients:
        raise RuntimeError("DAILY_SALES_REPORT_TO must contain at least one recipient")

    message = EmailMessage()
    message["From"] = f"Grid POS <{settings.daily_sales_report_from}>"
    message["To"] = ", ".join(recipients)
    message["Subject"] = f"Daily sales · {sales_date.strftime('%d %b %Y')}"
    message["Message-ID"] = f"<grid-daily-sales-{sales_date.isoformat()}@hundredacre.sg>"
    message.set_content(
        render_daily_sales_text(sales_date, dashboard, active_outlets, hourly_by_outlet)
    )
    message.add_alternative(
        render_daily_sales_html(sales_date, dashboard, active_outlets, hourly_by_outlet),
        subtype="html",
    )
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii").rstrip("=")

    async with httpx.AsyncClient(timeout=20.0) as client:
        token_response = await client.post(
            settings.gmail_oauth_token_url,
            data={
                "client_id": settings.gmail_api_client_id,
                "client_secret": settings.gmail_api_client_secret,
                "refresh_token": settings.gmail_api_refresh_token,
                "grant_type": "refresh_token",
            },
        )
        token_response.raise_for_status()
        access_token = token_response.json().get("access_token")
        if not access_token:
            raise RuntimeError("Google OAuth response did not include an access token")
        response = await client.post(
            f"{settings.gmail_api_url.rstrip('/')}/users/me/messages/send",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"raw": raw},
        )
    response.raise_for_status()
    return str(response.json()["id"])
