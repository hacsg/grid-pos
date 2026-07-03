"""REST API endpoints for KPay payment terminal integration.

Frontend calls these endpoints to initiate card payments and poll status.
Flow:
1. Frontend POST /api/kpay/start with order_id + amount
2. Backend creates PaymentIntent, sends start_sale to daemon
3. Frontend polls GET /api/kpay/status/{id} every 2s
4. Backend returns current status (pending → processing → success | failed)
"""

import logging
import secrets
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSessionLocal
from app.models.order import Order, OrderStatus
from app.models.staff import Staff
from app.routers.ws_daemon import get_daemon_connection
from app.services import idempotency, payment_intents
from app.utils.auth import get_current_staff

# Roles permitted to void/refund. The KPay manager password itself is held and
# encrypted by the daemon; this is the app-level authorization gate.
_MANAGER_ROLES = {"admin", "manager", "supervisor"}


def _ensure_manager(current_staff: Staff) -> None:
    role = getattr(current_staff.role, "value", current_staff.role)
    if str(role) not in _MANAGER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager authorization required for void/refund",
        )

log = logging.getLogger(__name__)

router = APIRouter()


def _ensure_staff_can_access_outlet(outlet_id: str, current_staff: Staff) -> None:
    """Ensure POS payment requests stay within the staff member's assigned outlet."""
    if str(current_staff.outlet_id) != outlet_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions for outlet",
        )


# ============================================================================
# Schemas
# ============================================================================

class KPayStartRequest(BaseModel):
    """Request body for POST /api/kpay/start"""
    order_id: str = Field(..., description="Order ID to link payment to")
    amount: float = Field(..., gt=0, description="Payment amount (e.g., 100.50)")
    # KPay paymentType: 1=card, 3=QR reverse scan, 13=PayNow, 14=Alipay,
    # 15=WeChat Pay, 16=Thai QR (all forward scan). Defaults to card.
    payment_type: int = Field(default=1, description="KPay paymentType enum")


class KPayStartResponse(BaseModel):
    """Response for successful payment initiation"""
    id: str = Field(..., description="Payment intent ID (use this for status polling)")
    out_trade_no: str = Field(..., description="KPay transaction reference")
    status: str = Field(..., description="Initial status (typically 'pending')")


class KPayStatusResponse(BaseModel):
    """Response for GET /api/kpay/status/{id}"""
    id: str
    status: str = Field(..., description="pending | processing | success | failed | timeout | cancelled")
    out_trade_no: Optional[str] = Field(None, description="KPay transaction reference")
    kpay_response: Optional[dict] = Field(None, description="Last KPay API response (if available)")
    error_message: Optional[str] = Field(None, description="Error message if payment failed")


class KPayConnectionResponse(BaseModel):
    """Response for GET /api/kpay/connection"""
    connected: bool = Field(..., description="Whether daemon is connected for this outlet")


class KPayQueryResponse(BaseModel):
    """Response for POST /api/kpay/{intent_id}/query"""
    id: str
    status: str = Field(
        ...,
        description="Intent status after query: success | failed | timeout | terminal_failed",
    )
    terminal_status: str = Field(
        ...,
        description="Coarse terminal outcome: success | failed | in-flight",
    )
    out_trade_no: Optional[str] = None
    kpay_response: Optional[dict] = None
    error_message: Optional[str] = None


class KPayReconcileRequest(BaseModel):
    """Daemon-posted terminal query result for background reconciliation."""
    pay_result: Optional[int] = None
    transaction_no: Optional[str] = None
    ref_no: Optional[str] = None
    pay_method: Optional[int] = None
    reason: Optional[str] = None
    out_trade_no: Optional[str] = None


class KPayReconcileResponse(BaseModel):
    id: str
    status: str
    terminal_status: str


class KPayReconciliationCandidate(BaseModel):
    id: str
    out_trade_no: str
    order_id: str
    status: str


def _ensure_daemon_token(x_daemon_token: str | None) -> None:
    if not x_daemon_token or not secrets.compare_digest(
        x_daemon_token, settings.kpay_daemon_token
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid daemon token")


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/connection", response_model=KPayConnectionResponse)
async def check_daemon_connection(
    outlet_id: str = Header(..., alias="X-Outlet-Id"),
    current_staff: Staff = Depends(get_current_staff),
) -> KPayConnectionResponse:
    """Check if Go daemon is connected for a given outlet.
    
    Used by frontend to show "Terminal connected" / "Terminal offline" indicator.
    """
    _ensure_staff_can_access_outlet(outlet_id, current_staff)
    ws = get_daemon_connection(outlet_id)
    return KPayConnectionResponse(connected=ws is not None)


@router.post("/start", response_model=KPayStartResponse)
async def start_payment(
    request: KPayStartRequest,
    outlet_id: str = Header(..., alias="X-Outlet-Id"),
    current_staff: Staff = Depends(get_current_staff),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> KPayStartResponse | JSONResponse:
    """Initiate a KPay card payment.

    Creates a payment intent, runs the sale on the terminal, and returns the
    final status. Returns 503 if the daemon is not connected.

    Two layers guard against double-charging an order:

    * An optional ``Idempotency-Key`` header dedupes retried requests (a network
      retry of the *same* click replays the original result).
    * A per-order guard, backed by the ``uq_payment_intents_active_per_order``
      partial unique index, refuses to start a second sale while one is active
      and returns the existing success if the order was already paid by card —
      so even a *fresh* duplicate click cannot trigger a second charge.
    """
    _ensure_staff_can_access_outlet(outlet_id, current_staff)

    # Check daemon connection
    ws = get_daemon_connection(outlet_id)
    if not ws:
        raise HTTPException(status_code=503, detail=f"Daemon not connected for outlet {outlet_id}")

    scope = "kpay.start"
    request_hash = idempotency.fingerprint(request.model_dump(mode="json"))

    async with AsyncSessionLocal() as session:
        if idempotency_key:
            replay = await idempotency.begin(session, scope, idempotency_key, request_hash)
            if replay is not None:
                return JSONResponse(replay.body, status_code=replay.status_code)

        try:
            # Domain guard: never start a second sale for an order that already
            # has an active intent, and return the existing success if already paid.
            existing = await payment_intents.get_active_intent_for_order(session, request.order_id)
            if existing is not None:
                if existing.status == "success":
                    body = jsonable_encoder(
                        KPayStartResponse(
                            id=str(existing.id),
                            out_trade_no=existing.out_trade_no,
                            status="success",
                        )
                    )
                    if idempotency_key:
                        await idempotency.complete(session, scope, idempotency_key, 200, body)
                    return JSONResponse(body, status_code=200)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A card payment is already in progress for this order",
                )

            # Load the order and enforce server-side authority on amount, status, and outlet.
            # Client cannot dictate the charged amount or pay a non-pending / foreign order.
            order = await session.get(Order, UUID(request.order_id))
            if order is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
            if order.status != OrderStatus.pending:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Order is not pending"
                )
            if order.outlet_id != current_staff.outlet_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Order belongs to a different outlet",
                )

            # A prior timeout/failed intent must be queried before a new sale.
            unresolved = await payment_intents.get_unresolved_intent_for_order(
                session, request.order_id
            )
            if unresolved is not None and not payment_intents.query_recently_performed(
                unresolved
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Must query previous intent before retrying",
                )

            server_total = order.total
            if Decimal(str(request.amount)) != server_total:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payment amount does not match order total",
                )

            # Create the intent using the *server* total (never the client-supplied amount).
            # The partial unique index is the race-safe
            # backstop: if a concurrent request created an active intent between
            # the check above and this insert, the commit raises IntegrityError.
            try:
                intent = await payment_intents.create_payment_intent(
                    session=session,
                    outlet_id=outlet_id,
                    order_id=request.order_id,
                    amount=server_total,
                )
            except IntegrityError:
                await session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A card payment is already in progress for this order",
                )

            # Run the sale synchronously: the daemon performs the blocking KPay
            # /sales call then queries the result and returns one terminal event.
            final_status = intent.status
            try:
                event = await payment_intents.start_sale_on_terminal(
                    intent, payment_type=request.payment_type
                )
                final_status = await payment_intents.finalize_sale(session, intent, event)
                log.info(f"Payment {intent.id} finished → {final_status}")
            except RuntimeError as e:
                error_msg = f"Terminal communication error: {str(e)}"
                await payment_intents.update_payment_intent_status(
                    session=session,
                    intent_id=intent.id,
                    status="failed",
                    error_message=error_msg,
                )
                final_status = "failed"
                log.error(f"Payment {intent.id} failed: {error_msg}")

            body = jsonable_encoder(
                KPayStartResponse(
                    id=str(intent.id),
                    out_trade_no=intent.out_trade_no,
                    status=final_status,
                )
            )
        except Exception:
            # Release our claim so a legitimate retry with the same key is not
            # blocked by a request that never produced a stored result.
            if idempotency_key:
                await idempotency.release(session, scope, idempotency_key)
            raise

        if idempotency_key:
            await idempotency.complete(session, scope, idempotency_key, 200, body)
        return JSONResponse(body, status_code=200)


@router.post("/{intent_id}/query", response_model=KPayQueryResponse)
async def query_payment_intent(
    intent_id: str,
    outlet_id: str = Header(..., alias="X-Outlet-Id"),
    current_staff: Staff = Depends(get_current_staff),
) -> KPayQueryResponse:
    """Query the terminal for the true state of a timeout/failed intent."""
    _ensure_staff_can_access_outlet(outlet_id, current_staff)

    if not get_daemon_connection(outlet_id):
        raise HTTPException(status_code=503, detail=f"Daemon not connected for outlet {outlet_id}")

    async with AsyncSessionLocal() as session:
        intent = await payment_intents.get_payment_intent(session, intent_id)
        if not intent:
            raise HTTPException(status_code=404, detail=f"Payment intent {intent_id} not found")
        if str(intent.outlet_id) != outlet_id:
            raise HTTPException(status_code=404, detail=f"Payment intent {intent_id} not found")
        if intent.status not in payment_intents.RETRY_GATE_STATUSES:
            return KPayQueryResponse(
                id=str(intent.id),
                status=intent.status,
                terminal_status=payment_intents._terminal_status_from_event(
                    intent.kpay_response or {}
                )
                if intent.kpay_response
                else ("success" if intent.status == "success" else "failed"),
                out_trade_no=intent.out_trade_no,
                kpay_response=intent.kpay_response,
                error_message=intent.error_message,
            )

        try:
            event = await payment_intents.query_on_terminal(outlet_id, intent.out_trade_no)
        except RuntimeError as e:
            raise HTTPException(
                status_code=502, detail=f"Terminal communication error: {e}"
            ) from e

        final_status = await payment_intents.finalize_query(session, intent, event)
        refreshed = await payment_intents.get_payment_intent(session, intent_id)
        assert refreshed is not None
        terminal_status = payment_intents._terminal_status_from_event(event)
        return KPayQueryResponse(
            id=str(refreshed.id),
            status=final_status,
            terminal_status=terminal_status,
            out_trade_no=refreshed.out_trade_no,
            kpay_response=refreshed.kpay_response,
            error_message=refreshed.error_message,
        )


@router.get("/reconciliation-candidates", response_model=list[KPayReconciliationCandidate])
async def list_reconciliation_candidates(
    outlet_id: str = Header(..., alias="X-Outlet-Id"),
    x_daemon_token: str | None = Header(default=None, alias="X-Daemon-Token"),
) -> list[KPayReconciliationCandidate]:
    """Return recent timeout/failed intents for daemon background reconciliation."""
    _ensure_daemon_token(x_daemon_token)

    async with AsyncSessionLocal() as session:
        intents = await payment_intents.get_stale_intents_for_reconciliation(
            session, outlet_id
        )
        return [
            KPayReconciliationCandidate(
                id=str(i.id),
                out_trade_no=i.out_trade_no,
                order_id=str(i.order_id),
                status=i.status,
            )
            for i in intents
        ]


@router.post("/{intent_id}/reconcile", response_model=KPayReconcileResponse)
async def reconcile_payment_intent(
    intent_id: str,
    body: KPayReconcileRequest,
    outlet_id: str = Header(..., alias="X-Outlet-Id"),
    x_daemon_token: str | None = Header(default=None, alias="X-Daemon-Token"),
) -> KPayReconcileResponse:
    """Apply a daemon-side terminal query result to a stale intent."""
    _ensure_daemon_token(x_daemon_token)

    async with AsyncSessionLocal() as session:
        intent = await payment_intents.get_payment_intent(session, intent_id)
        if not intent:
            raise HTTPException(status_code=404, detail=f"Payment intent {intent_id} not found")
        if str(intent.outlet_id) != outlet_id:
            raise HTTPException(status_code=404, detail=f"Payment intent {intent_id} not found")
        if intent.status not in payment_intents.RETRY_GATE_STATUSES:
            terminal_status = (
                "success"
                if intent.status == "success"
                else "failed"
            )
            return KPayReconcileResponse(
                id=str(intent.id),
                status=intent.status,
                terminal_status=terminal_status,
            )

        event = {
            "type": "query_result",
            "out_trade_no": body.out_trade_no or intent.out_trade_no,
            "pay_result": body.pay_result,
            "transaction_no": body.transaction_no,
            "ref_no": body.ref_no,
            "pay_method": body.pay_method,
            "reason": body.reason,
        }
        final_status = await payment_intents.finalize_query(
            session,
            intent,
            event,
            mark_terminal_failed_on_decline=True,
        )
        terminal_status = payment_intents._terminal_status_from_event(event)
        return KPayReconcileResponse(
            id=str(intent.id),
            status=final_status,
            terminal_status=terminal_status,
        )


@router.get("/status/{id}", response_model=KPayStatusResponse)
async def get_payment_status(
    id: str,
    outlet_id: str = Header(..., alias="X-Outlet-Id"),
    current_staff: Staff = Depends(get_current_staff),
) -> KPayStatusResponse:
    """Get current status of a payment intent.
    
    Frontend polls this every 2s to track payment progress.
    """
    _ensure_staff_can_access_outlet(outlet_id, current_staff)
    
    async with AsyncSessionLocal() as session:
        intent = await payment_intents.get_payment_intent(session, id)
        
        if not intent:
            raise HTTPException(status_code=404, detail=f"Payment intent {id} not found")
        
        if intent.outlet_id != outlet_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment intent {id} not found",
            )
        
        return KPayStatusResponse(
            id=intent.id,
            status=intent.status,
            out_trade_no=intent.out_trade_no,
            kpay_response=intent.kpay_response,
            error_message=intent.error_message,
        )


# ============================================================================
# Void & Refund
# ============================================================================

class KPayReversalRequest(BaseModel):
    """Request body for POST /api/kpay/void and /api/kpay/refund."""
    order_id: str = Field(..., description="Order whose card payment is being reversed")
    amount: Optional[float] = Field(
        default=None, gt=0, description="Refund amount (defaults to full order total)"
    )


class KPayReversalResponse(BaseModel):
    result: str = Field(..., description="ok | failed")
    out_trade_no: str
    message: Optional[str] = None


def _reversal_failed(event: dict) -> Optional[str]:
    """Return an error message if a cancel/refund event was not successful."""
    if event.get("type") == "error":
        return event.get("message") or "Terminal error"
    if not event.get("success"):
        return "Terminal did not confirm the reversal"
    return None


@router.post("/void", response_model=KPayReversalResponse)
async def void_payment(
    request: KPayReversalRequest,
    outlet_id: str = Header(..., alias="X-Outlet-Id"),
    current_staff: Staff = Depends(get_current_staff),
) -> KPayReversalResponse:
    """Void (cancel) a same-day card sale on the terminal and mark the order cancelled."""
    _ensure_staff_can_access_outlet(outlet_id, current_staff)
    _ensure_manager(current_staff)

    if not get_daemon_connection(outlet_id):
        raise HTTPException(status_code=503, detail=f"Daemon not connected for outlet {outlet_id}")

    async with AsyncSessionLocal() as session:
        intent = await payment_intents.get_successful_intent_for_order(session, request.order_id)
        if not intent:
            raise HTTPException(status_code=404, detail="No successful card payment found for this order")

        void_no = payment_intents.new_out_trade_no("VOID")
        try:
            event = await payment_intents.cancel_on_terminal(outlet_id, void_no, intent.out_trade_no)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=f"Terminal communication error: {e}")

        error = _reversal_failed(event)
        if error:
            return KPayReversalResponse(result="failed", out_trade_no=void_no, message=error)

        await _set_order_status(session, request.order_id, OrderStatus.cancelled)
        log.info(f"Voided order {request.order_id} (origin {intent.out_trade_no})")
        return KPayReversalResponse(result="ok", out_trade_no=void_no)


@router.post("/refund", response_model=KPayReversalResponse)
async def refund_payment(
    request: KPayReversalRequest,
    outlet_id: str = Header(..., alias="X-Outlet-Id"),
    current_staff: Staff = Depends(get_current_staff),
) -> KPayReversalResponse:
    """Refund a settled card sale on the terminal and mark the order refunded."""
    _ensure_staff_can_access_outlet(outlet_id, current_staff)
    _ensure_manager(current_staff)

    if not get_daemon_connection(outlet_id):
        raise HTTPException(status_code=503, detail=f"Daemon not connected for outlet {outlet_id}")

    async with AsyncSessionLocal() as session:
        order = await session.get(Order, request.order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        intent = await payment_intents.get_successful_intent_for_order(session, request.order_id)
        if not intent:
            raise HTTPException(status_code=404, detail="No successful card payment found for this order")

        refund_amount = Decimal(str(request.amount)) if request.amount is not None else order.total
        kp = intent.kpay_response or {}
        refund_no = payment_intents.new_out_trade_no("RFND")
        try:
            event = await payment_intents.refund_on_terminal(
                outlet_id,
                out_trade_no=refund_no,
                origin_out_trade_no=intent.out_trade_no,
                refund_amount_cents=payment_intents._to_cents(refund_amount),
                ref_no=str(kp.get("ref_no") or ""),
                transaction_no=str(kp.get("transaction_no") or ""),
            )
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=f"Terminal communication error: {e}")

        error = _reversal_failed(event)
        if error:
            return KPayReversalResponse(result="failed", out_trade_no=refund_no, message=error)

        await _set_order_status(session, request.order_id, OrderStatus.refunded)
        log.info(f"Refunded order {request.order_id} amount {refund_amount} (origin {intent.out_trade_no})")
        return KPayReversalResponse(result="ok", out_trade_no=refund_no)


async def _set_order_status(session, order_id: str, new_status: OrderStatus) -> None:
    """Transition a paid order to cancelled/refunded after a confirmed reversal."""
    order = await session.get(Order, order_id)
    if order and order.status == OrderStatus.paid:
        order.status = new_status
        await session.commit()
