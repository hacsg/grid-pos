"""Daily sales email report and protected cron endpoint tests."""

import base64
from datetime import datetime
from decimal import Decimal
from email import policy
from email.parser import BytesParser

import pytest

from app.config import settings
from app.models.order import Order, OrderStatus
from app.routers import daily_sales as daily_sales_router
from app.services import daily_sales_email
from app.services.daily_sales_email import (
    build_daily_sales_report,
    render_daily_sales_html,
    send_daily_sales_email,
)
from app.utils.timezone import SGT, UTC


async def _order(db, *, number, outlet_id, staff_id, total, created_sgt):
    order = Order(
        order_number=number,
        outlet_id=outlet_id,
        staff_id=staff_id,
        subtotal=Decimal(total),
        total=Decimal(total),
        status=OrderStatus.paid,
        payment_method="cash",
    )
    order.created_at = created_sgt.astimezone(UTC)
    db.add(order)
    await db.commit()
    return order


@pytest.mark.asyncio
async def test_report_filters_zero_outlets_and_buckets_each_hour(
    db_session, outlet, another_outlet, cashier_staff
):
    await _order(
        db_session,
        number="D001",
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        total="12.50",
        created_sgt=datetime(2026, 8, 31, 9, 15, tzinfo=SGT),
    )
    await _order(
        db_session,
        number="D002",
        outlet_id=another_outlet.id,
        staff_id=cashier_staff.id,
        total="20.00",
        created_sgt=datetime(2026, 8, 31, 14, 45, tzinfo=SGT),
    )
    # A paid zero-value order must not make the outlet appear in the email.
    from app.models.outlet import Outlet

    zero_outlet = Outlet(name="Zero Outlet", address="Nowhere")
    db_session.add(zero_outlet)
    await db_session.commit()
    await db_session.refresh(zero_outlet)
    await _order(
        db_session,
        number="D003",
        outlet_id=zero_outlet.id,
        staff_id=cashier_staff.id,
        total="0.00",
        created_sgt=datetime(2026, 8, 31, 10, 0, tzinfo=SGT),
    )

    report, active, hourly = await build_daily_sales_report(
        db_session, datetime(2026, 8, 31).date()
    )

    assert {item.outlet_name for item in active} == {"Test Outlet", "Another Outlet"}
    assert hourly[outlet.id][9] == 12.50
    assert hourly[another_outlet.id][14] == 20.00
    html = render_daily_sales_html(datetime(2026, 8, 31).date(), report, active, hourly)
    assert "Zero Outlet" not in html
    assert "00:00–01:00" not in html
    assert "09:00–10:00" in html
    assert "14:00–15:00" in html
    assert "23:00–00:00" not in html
    assert "S$32.50" in html


@pytest.mark.asyncio
async def test_cron_endpoint_requires_secret(client, monkeypatch):
    monkeypatch.setattr(settings, "daily_sales_cron_secret", "test-report-secret")
    response = await client.post("/api/daily-sales/send")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_cron_endpoint_sends_to_configured_recipient(
    client, db_session, outlet, cashier_staff, monkeypatch
):
    await _order(
        db_session,
        number="D004",
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        total="18.00",
        created_sgt=datetime(2026, 8, 31, 18, 0, tzinfo=SGT),
    )
    monkeypatch.setattr(settings, "daily_sales_cron_secret", "test-report-secret")
    monkeypatch.setattr(settings, "daily_sales_report_to", "hello@hundredacre.sg")

    sent = {}

    async def fake_send(sales_date, dashboard, active_outlets, hourly):
        sent["date"] = sales_date
        sent["outlets"] = [item.outlet_name for item in active_outlets]
        return "email_123"

    monkeypatch.setattr(daily_sales_router, "send_daily_sales_email", fake_send)
    response = await client.post(
        "/api/daily-sales/send",
        params={"sales_date": "2026-08-31"},
        headers={"X-Cron-Secret": "test-report-secret"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "sales_date": "2026-08-31",
        "sent": True,
        "email_id": "email_123",
        "recipient": "hello@hundredacre.sg",
        "outlets": ["Test Outlet"],
    }
    assert sent["outlets"] == ["Test Outlet"]


@pytest.mark.asyncio
async def test_cron_endpoint_skips_all_zero_day(client, monkeypatch):
    monkeypatch.setattr(settings, "daily_sales_cron_secret", "test-report-secret")
    response = await client.post(
        "/api/daily-sales/send",
        params={"sales_date": "2026-08-31"},
        headers={"X-Cron-Secret": "test-report-secret"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "sales_date": "2026-08-31",
        "sent": False,
        "reason": "no_nonzero_sales",
    }


@pytest.mark.asyncio
async def test_gmail_sender_refreshes_token_and_sends_mime_message(
    db_session, outlet, cashier_staff, monkeypatch
):
    report_date = datetime(2026, 8, 31).date()
    await _order(
        db_session,
        number="D005",
        outlet_id=outlet.id,
        staff_id=cashier_staff.id,
        total="21.00",
        created_sgt=datetime(2026, 8, 31, 11, 0, tzinfo=SGT),
    )
    report, active, hourly = await build_daily_sales_report(db_session, report_date)
    monkeypatch.setattr(settings, "gmail_api_client_id", "client-id")
    monkeypatch.setattr(settings, "gmail_api_client_secret", "client-secret")
    monkeypatch.setattr(settings, "gmail_api_refresh_token", "refresh-token")
    monkeypatch.setattr(settings, "daily_sales_report_from", "hello@hundredacre.sg")
    monkeypatch.setattr(settings, "daily_sales_report_to", "hello@hundredacre.sg")

    calls = []

    class FakeResponse:
        def __init__(self, body):
            self.body = body

        def raise_for_status(self):
            return None

        def json(self):
            return self.body

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            if "oauth2.googleapis.com" in url:
                return FakeResponse({"access_token": "access-token"})
            return FakeResponse({"id": "gmail-message-123"})

    monkeypatch.setattr(daily_sales_email.httpx, "AsyncClient", FakeClient)
    message_id = await send_daily_sales_email(report_date, report, active, hourly)

    assert message_id == "gmail-message-123"
    assert calls[0][1]["data"]["grant_type"] == "refresh_token"
    assert calls[1][1]["headers"] == {"Authorization": "Bearer access-token"}
    encoded = calls[1][1]["json"]["raw"]
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    message = BytesParser(policy=policy.default).parsebytes(raw)
    assert message["From"] == "Grid POS <hello@hundredacre.sg>"
    assert message["To"] == "hello@hundredacre.sg"
    assert message["Message-ID"] == "<grid-daily-sales-2026-08-31@hundredacre.sg>"
    assert message.is_multipart()
