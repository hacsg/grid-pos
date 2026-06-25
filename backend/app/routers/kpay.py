"""REST API endpoints for KPay payment terminal integration.

Frontend calls these endpoints to initiate card payments and poll status.
Flow:
1. Frontend POST /api/kpay/start with order_id + amount
2. Backend creates PaymentIntent, sends start_sale to daemon
3. Frontend polls GET /api/kpay/status/{id} every 2s
4. Backend returns current status (pending → processing → success | failed)
"""

import logging
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.order import Order, OrderStatus
from app.models.staff import Staff
from app.routers.ws_daemon import get_daemon_connection
from app.services import payment_intents
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
) -> KPayStartResponse:
    """Initiate a KPay card payment.
    
    Creates payment intent, sends start_sale to daemon, returns intent ID for polling.
    Returns 503 if daemon not connected.
    """
    _ensure_staff_can_access_outlet(outlet_id, current_staff)
    
    # Check daemon connection
    ws = get_daemon_connection(outlet_id)
    if not ws:
        raise HTTPException(status_code=503, detail=f"Daemon not connected for outlet {outlet_id}")
    
    async with AsyncSessionLocal() as session:
        # Create payment intent
        intent = await payment_intents.create_payment_intent(
            session=session,
            outlet_id=outlet_id,
            order_id=request.order_id,
            amount=Decimal(str(request.amount)),
        )

        # Run the sale synchronously: the daemon performs the blocking KPay /sales
        # call then queries the result and returns one terminal event.
        final_status = intent.status
        try:
            event = await payment_intents.start_sale_on_terminal(intent)
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

        return KPayStartResponse(
            id=intent.id,
            out_trade_no=intent.out_trade_no,
            status=final_status,
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
