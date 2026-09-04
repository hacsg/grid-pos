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
    outlet_rows = "".join(
        f'<tr><td style="padding:12px 10px;border-bottom:1px solid #e7e5e4">'
        f'<strong style="font-size:15px">{escape(outlet.outlet_name)}</strong><br>'
        f'<span style="font-size:12px;color:#78716c">{outlet.transactions:,} transactions</span></td>'
        f'<td style="padding:12px 10px;text-align:right;border-bottom:1px solid #e7e5e4;white-space:nowrap">'
        f'<strong style="font-size:20px">{_money(outlet.net_sales)}</strong></td></tr>'
        for outlet in active_outlets
    )
    hourly_sections = []
    for outlet in active_outlets:
        values = hourly_by_outlet[UUID(outlet.outlet_id)]
        rows = "".join(
            f'<tr><td style="padding:8px 10px;border-bottom:1px solid #f3f4f6">{_hour_label(hour)}</td>'
            f'<td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f3f4f6;white-space:nowrap">{_money(value)}</td></tr>'
            for hour, value in enumerate(values)
            if value != 0
        )
        hourly_sections.append(
            f'<h3 style="font-size:15px;margin:20px 0 6px">{escape(outlet.outlet_name)}'
            f'<span style="float:right;color:#57534e">{_money(outlet.net_sales)}</span></h3>'
            f'<table style="width:100%;border-collapse:collapse;font-size:13px">'
            f'<thead><tr><th style="padding:8px 10px;text-align:left;border-bottom:1px solid #d6d3d1">Hour (SGT)</th>'
            f'<th style="padding:8px 10px;text-align:right;border-bottom:1px solid #d6d3d1">Revenue</th></tr></thead>'
            f'<tbody>{rows}</tbody></table>'
        )

    payments = "".join(
        f'<tr><td style="padding:7px">{escape(item.method)}</td><td style="padding:7px;text-align:right">{_money(item.amount)}</td></tr>'
        for item in dashboard.payments
        if item.amount != 0
    )
    products = "".join(
        f'<tr><td style="padding:8px 6px;overflow-wrap:anywhere">{escape(item.name)}</td>'
        f'<td style="padding:8px 6px;text-align:right;white-space:nowrap">{item.quantity:,}</td>'
        f'<td style="padding:8px 6px;text-align:right;white-space:nowrap">{_money(item.revenue)}</td></tr>'
        for item in dashboard.top_by_revenue
    )
    kpis = dashboard.kpis
    report_date = sales_date.strftime("%A, %d %B %Y")
    return f"""<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>@media only screen and (max-width:600px){{.outer{{padding:0!important}}.content{{padding:18px!important;border-radius:0!important}}}}</style>
</head><body style="margin:0;background:#f5f5f4;color:#1c1917;font-family:Arial,sans-serif;-webkit-text-size-adjust:100%">
<div class="outer" style="max-width:640px;margin:0 auto;padding:16px">
  <div class="content" style="background:#fff;border-radius:12px;padding:24px">
    <div style="font-size:12px;color:#78716c;letter-spacing:.08em;text-transform:uppercase">Grid POS · Daily sales</div>
    <h1 style="font-size:26px;margin:6px 0">{escape(report_date)}</h1>
    <p style="color:#78716c;margin:0 0 18px">All figures use Singapore time (SGT). Outlets with zero sales are omitted.</p>
    <h2 style="font-size:17px;margin:24px 0 8px">Sales by outlet</h2>
    <table style="width:100%;border-collapse:collapse;background:#fafaf9">{outlet_rows}</table>
    <h2 style="font-size:17px;margin:28px 0 8px">Group overview</h2>
    <table style="width:100%;border-collapse:collapse;background:#fafaf9;font-size:14px">
      <tr><td style="padding:9px 10px">Net sales</td><td style="padding:9px 10px;text-align:right"><strong>{_money(kpis.net_sales)}</strong></td></tr>
      <tr><td style="padding:9px 10px">Gross sales</td><td style="padding:9px 10px;text-align:right"><strong>{_money(kpis.gross_sales)}</strong></td></tr>
      <tr><td style="padding:9px 10px">Transactions</td><td style="padding:9px 10px;text-align:right"><strong>{kpis.transactions:,}</strong></td></tr>
      <tr><td style="padding:9px 10px">Items sold</td><td style="padding:9px 10px;text-align:right"><strong>{kpis.items_sold:,}</strong></td></tr>
      <tr><td style="padding:9px 10px">Average ticket</td><td style="padding:9px 10px;text-align:right"><strong>{_money(kpis.avg_ticket)}</strong></td></tr>
    </table>
    <h2 style="font-size:17px;margin:28px 0 8px">Hourly earnings by outlet</h2>
    {''.join(hourly_sections)}
    <h2 style="font-size:17px;margin:28px 0 8px">Payment mix</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">{payments}</table>
    <h2 style="font-size:17px;margin:28px 0 8px">Redemptions</h2>
    <p style="font-size:14px">CDC: <strong>{_money(dashboard.redemptions.cdc.value)}</strong> ({dashboard.redemptions.cdc.orders:,} orders)</p>
    <p style="font-size:14px">Vouchers: <strong>{_money(dashboard.redemptions.vouchers.value)}</strong> ({dashboard.redemptions.vouchers.count:,} redemptions)</p>
    <h2 style="font-size:17px;margin:28px 0 8px">Top products by revenue</h2>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px"><thead><tr><th style="width:56%;text-align:left">Product</th><th style="width:14%;text-align:right">Qty</th><th style="width:30%;text-align:right">Revenue</th></tr></thead><tbody>{products}</tbody></table>
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
        values = [hourly_by_outlet[UUID(o.outlet_id)][hour] for o in active_outlets]
        if sum(values) == 0:
            continue
        parts = [f"{o.outlet_name}: {_money(value)}" for o, value in zip(active_outlets, values)]
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
