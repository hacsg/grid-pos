"""Payment intent service: CRUD + background polling for KPay terminal.

Handles the lifecycle of payment transactions that flow through the Go daemon:
- Create payment intent when frontend calls POST /api/kpay/start
- Background loop polls processing intents every 2s via WS to daemon
- When terminal state reached, update intent status + order payment fields
- Timeout after 90s if no terminal state

State machine: pending → processing → success | failed | timeout | cancelled
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.order import Order
from app.models.payment_intent import PaymentIntent
from app.routers.ws_daemon import get_daemon_connection, send_to_daemon

log = logging.getLogger(__name__)


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
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    random_suffix = uuid.uuid4().hex[:8].upper()
    out_trade_no = f"KPAY-{timestamp}-{random_suffix}"
    
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
    
    # If terminal state, also update the order
    if status in ("success", "failed") and kpay_response:
        # Fetch the intent to get order_id and out_trade_no
        intent_result = await session.execute(select(PaymentIntent).where(PaymentIntent.id == intent_id))
        intent = intent_result.scalar_one_or_none()
        
        if intent:
            # Update order payment fields
            if status == "success":
                order_stmt = update(Order).where(Order.id == intent.order_id).values(
                    payment_method="card",
                    payment_reference=intent.out_trade_no,
                )
                await session.execute(order_stmt)
                log.info(f"Updated order {intent.order_id} with card payment {intent.out_trade_no}")
    
    await session.commit()
    log.info(f"Payment intent {intent_id} status → {status}")


# ============================================================================
# KPay Terminal Communication
# ============================================================================

async def start_sale_on_terminal(intent: PaymentIntent) -> dict:
    """Send start_sale command to daemon for this payment intent.
    
    Returns daemon response dict with 'success' and 'result' fields.
    Raises RuntimeError if daemon not connected or timeout.
    """
    # Format amount for KPay (12-digit zero-padded string)
    amount_cents = int(intent.amount * 100)
    amount_str = f"{amount_cents:012d}"
    
    params = {
        "outTradeNo": intent.out_trade_no,
        "amount": amount_str,
        "paymentType": 1,
    }
    
    log.info(f"Sending start_sale to daemon: {intent.outlet_id}, amount={amount_str}")
    
    # Send to daemon with 60s timeout (KPay spec says response within 60s)
    response = await send_to_daemon(intent.outlet_id, "start_sale", params, timeout=60.0)
    return response


async def query_terminal(intent: PaymentIntent) -> dict:
    """Send query command to daemon to check payment status.
    
    Returns daemon response dict with 'success' and 'result' fields.
    Raises RuntimeError if daemon not connected or timeout.
    """
    time_ref = ""
    if intent.kpay_response and "timeRef" in intent.kpay_response:
        time_ref = intent.kpay_response["timeRef"]
    
    params = {
        "outTradeNo": intent.out_trade_no,
        "timeRef": time_ref,
    }
    
    log.debug(f"Querying terminal for {intent.out_trade_no}")
    
    # Send to daemon with 10s timeout
    response = await send_to_daemon(intent.outlet_id, "query", params, timeout=10.0)
    return response


# ============================================================================
# Background Polling Loop
# ============================================================================

async def process_single_intent(session: AsyncSession, intent: PaymentIntent) -> None:
    """Poll terminal for a single processing payment intent.
    
    Updates status to success/failed/timeout based on terminal response.
    """
    try:
        # Check timeout
        created_at = intent.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age_seconds = (datetime.now(timezone.utc) - created_at).total_seconds()
        if age_seconds > 90:
            log.warning(f"Payment intent {intent.id} timed out after {age_seconds:.1f}s")
            await update_payment_intent_status(
                session,
                intent.id,
                status="timeout",
                error_message="Payment timed out (no response in 90s)",
            )
            return
        
        # Query terminal
        response = await query_terminal(intent)
        
        if not response.get("success"):
            log.warning(f"Query failed for {intent.id}: {response.get('error')}")
            return  # Will retry next cycle
        
        # Extract terminal state from response
        result = response.get("result", {})
        terminal_status = result.get("status", "").upper()
        
        # KPay terminal states: SUCCESS, FAILED, TIMEOUT
        if terminal_status == "SUCCESS":
            await update_payment_intent_status(
                session,
                intent.id,
                status="success",
                kpay_response=result,
            )
            log.info(f"Payment {intent.id} succeeded")
        
        elif terminal_status in ("FAILED", "ERROR"):
            error_msg = result.get("message", "Payment failed")
            await update_payment_intent_status(
                session,
                intent.id,
                status="failed",
                kpay_response=result,
                error_message=error_msg,
            )
            log.warning(f"Payment {intent.id} failed: {error_msg}")
        
        # If pending/partial, do nothing — will retry next cycle
    
    except RuntimeError as e:
        log.error(f"Error polling terminal for {intent.id}: {e}")
        # Will retry next cycle
    
    except Exception as e:
        log.error(f"Unexpected error polling {intent.id}: {e}", exc_info=True)


async def polling_loop() -> None:
    """Background task that polls processing payment intents every 2s.
    
    Runs indefinitely until the app shuts down. Queries all intents with
    status='processing' and sends query command to daemon. Updates status
    when terminal state is reached.
    """
    log.info("Payment intent polling loop started")
    
    while True:
        try:
            async with AsyncSessionLocal() as session:
                # Fetch all processing intents
                result = await session.execute(
                    select(PaymentIntent).where(PaymentIntent.status == "processing")
                )
                intents = result.scalars().all()
                
                if intents:
                    log.debug(f"Polling {len(intents)} processing payment intent(s)")
            
            # Process each intent in its own session so one failure cannot block the batch.
            for intent in intents:
                async with AsyncSessionLocal() as intent_session:
                    await process_single_intent(intent_session, intent)
        
        except asyncio.CancelledError:
            log.info("Payment intent polling loop cancelled")
            break
        
        except Exception as e:
            log.error(f"Error in polling loop: {e}", exc_info=True)
        
        # Sleep 2s between cycles
        await asyncio.sleep(2)
