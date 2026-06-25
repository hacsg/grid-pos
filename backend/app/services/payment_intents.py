"""Payment intent service: CRUD + background polling for KPay terminal.

Handles the lifecycle of payment transactions that flow through the Go daemon:
- Create payment intent when frontend calls POST /api/kpay/start
- Background loop polls processing intents every 2s via WS to daemon
- When terminal state reached, update intent status + order payment fields
- Timeout after 90s if no terminal state

State machine: pending → processing → success | failed | timeout | cancelled
"""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.order import Order
from app.models.payment_intent import PaymentIntent
from app.routers.ws_daemon import send_to_daemon

log = logging.getLogger(__name__)


def _to_cents(amount: Decimal) -> int:
    """Convert a money Decimal to integer cents without float rounding error."""
    return int((amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) * 100))


def new_out_trade_no(prefix: str = "KPAY") -> str:
    """Generate a unique merchant transaction reference for a KPay operation."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"{prefix}-{timestamp}-{uuid.uuid4().hex[:8].upper()}"


# ============================================================================
# CRUD Operations
# ============================================================================

async def create_payment_intent(
    session: AsyncSession,
    outlet_id: str,
    order_id: str,
    amount: Decimal,
) -> PaymentIntent:
    """Create a new payment intent in pending state.
    
    Args:
        session: Database session
        outlet_id: Which outlet's terminal to use
        order_id: Order to link payment to
        amount: Amount in currency units (e.g., 100.50)
    
    Returns:
        Created PaymentIntent with generated out_trade_no
    """
    # Generate unique transaction reference for KPay
    out_trade_no = new_out_trade_no()

    intent = PaymentIntent(
        id=uuid.uuid4(),
        outlet_id=outlet_id,
        order_id=order_id,
        out_trade_no=out_trade_no,
        amount=amount,
        status="pending",
    )
    
    session.add(intent)
    await session.commit()
    await session.refresh(intent)
    
    log.info(f"Created payment intent {intent.id} for order {order_id}, amount {amount}")
    return intent


async def get_payment_intent(session: AsyncSession, intent_id: str) -> Optional[PaymentIntent]:
    """Fetch payment intent by ID."""
    result = await session.execute(select(PaymentIntent).where(PaymentIntent.id == intent_id))
    return result.scalar_one_or_none()


async def get_successful_intent_for_order(
    session: AsyncSession, order_id: str
) -> Optional[PaymentIntent]:
    """Return the most recent successful card payment intent for an order."""
    result = await session.execute(
        select(PaymentIntent)
        .where(PaymentIntent.order_id == order_id, PaymentIntent.status == "success")
        .order_by(PaymentIntent.created_at.desc())
    )
    return result.scalars().first()


async def update_payment_intent_status(
    session: AsyncSession,
    intent_id: str,
    status: str,
    kpay_response: Optional[dict] = None,
    error_message: Optional[str] = None,
) -> None:
    """Update payment intent status and metadata.
    
    If status is success/failed, also update the linked order's payment fields.
    """
    # Update the intent
    stmt = update(PaymentIntent).where(PaymentIntent.id == intent_id).values(
        status=status,
        kpay_response=kpay_response,
        error_message=error_message,
        updated_at=datetime.now(timezone.utc),
    )
    await session.execute(stmt)
    
    # On success, stamp the order with the KPay transaction reference. Prefer the
    # KPay transactionNo (needed for downstream refunds) and fall back to out_trade_no.
    if status == "success":
        intent_result = await session.execute(select(PaymentIntent).where(PaymentIntent.id == intent_id))
        intent = intent_result.scalar_one_or_none()
        if intent:
            reference = intent.out_trade_no
            if kpay_response and kpay_response.get("transaction_no"):
                reference = kpay_response["transaction_no"]
            order_stmt = update(Order).where(Order.id == intent.order_id).values(
                payment_method="card",
                payment_reference=reference,
            )
            await session.execute(order_stmt)
            log.info(f"Updated order {intent.order_id} with card payment ref {reference}")

    await session.commit()
    log.info(f"Payment intent {intent_id} status → {status}")


# ============================================================================
# KPay Terminal Communication
# ============================================================================

# KPay payment type for a unified card sale. TODO(kpay): confirm enum vs docs.
_DEFAULT_PAYMENT_TYPE = 1


def _normalize_sale_result(event: dict) -> dict:
    """Pull the fields we persist from a daemon sale_result/query_result event."""
    return {
        "out_trade_no": event.get("out_trade_no"),
        "transaction_no": event.get("transaction_no"),
        "ref_no": event.get("ref_no"),
        "pay_method": event.get("pay_method"),
        "pay_result": event.get("pay_result"),
    }


# KPay query payResult enum (KPOS LAN spec).
_PAYRESULT_LABELS = {
    -1: "timed out",
    1: "still pending",
    2: "successful",
    3: "declined",
    4: "returned",
    5: "canceled",
    6: "transaction canceled",
}


def _pay_result(event: dict) -> Optional[int]:
    try:
        return int(event.get("pay_result"))
    except (TypeError, ValueError):
        return None


def _is_approved(event: dict) -> bool:
    """Interpret the daemon's KPay payResult against the configured success code."""
    return _pay_result(event) == settings.kpay_payresult_success


async def start_sale_on_terminal(intent: PaymentIntent, payment_type: int = _DEFAULT_PAYMENT_TYPE) -> dict:
    """Run a card sale on the terminal and wait for the final result.

    The Go daemon performs the blocking KPay /sales call then queries the result,
    returning a single sale_result (or error) event. Raises RuntimeError if the
    daemon is not connected or times out.
    """
    params = {
        "out_trade_no": intent.out_trade_no,
        "amount_cents": _to_cents(intent.amount),
        "payment_type": payment_type,
    }
    log.info(f"start_sale → daemon outlet={intent.outlet_id} no={intent.out_trade_no} cents={params['amount_cents']}")
    return await send_to_daemon(
        intent.outlet_id, "start_sale", params, timeout=settings.kpay_sale_timeout_seconds
    )


async def finalize_sale(session: AsyncSession, intent: PaymentIntent, event: dict) -> str:
    """Interpret a terminal sale event, persist the outcome, and return the status."""
    if event.get("type") == "error":
        message = event.get("message") or "Terminal error"
        await update_payment_intent_status(
            session, intent.id, status="failed",
            kpay_response=_normalize_sale_result(event), error_message=message,
        )
        return "failed"

    result = _normalize_sale_result(event)
    if _is_approved(event):
        await update_payment_intent_status(session, intent.id, status="success", kpay_response=result)
        return "success"

    code = _pay_result(event)
    label = _PAYRESULT_LABELS.get(code, f"payResult={event.get('pay_result')}")
    # payResult 1 = pending: the terminal hasn't reached a final state yet.
    status_value = "timeout" if code in (-1, 1) else "failed"
    message = f"Card payment {label}"
    await update_payment_intent_status(
        session, intent.id, status=status_value, kpay_response=result, error_message=message,
    )
    return status_value


async def cancel_on_terminal(outlet_id: str, out_trade_no: str, origin_out_trade_no: str) -> dict:
    """Void/cancel a same-day KPay sale via the daemon (manager password injected daemon-side)."""
    params = {"out_trade_no": out_trade_no, "origin_out_trade_no": origin_out_trade_no}
    log.info(f"cancel → daemon outlet={outlet_id} origin={origin_out_trade_no}")
    return await send_to_daemon(outlet_id, "cancel", params, timeout=settings.kpay_sale_timeout_seconds)


async def refund_on_terminal(
    outlet_id: str,
    out_trade_no: str,
    origin_out_trade_no: str,
    refund_amount_cents: int,
    ref_no: str = "",
    transaction_no: str = "",
    refund_type: int = 1,
    commit_time: int = 0,
) -> dict:
    """Refund a settled KPay sale via the daemon (manager password injected daemon-side)."""
    params = {
        "out_trade_no": out_trade_no,
        "origin_out_trade_no": origin_out_trade_no,
        "refund_type": refund_type,
        "refund_amount_cents": refund_amount_cents,
        "ref_no": ref_no,
        "transaction_no": transaction_no,
        "commit_time": commit_time,
    }
    log.info(f"refund → daemon outlet={outlet_id} origin={origin_out_trade_no} cents={refund_amount_cents}")
    return await send_to_daemon(outlet_id, "refund", params, timeout=settings.kpay_sale_timeout_seconds)
