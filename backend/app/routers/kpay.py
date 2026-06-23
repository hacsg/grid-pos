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

from app.database import AsyncSessionLocal
from app.models.staff import Staff
from app.routers.ws_daemon import get_daemon_connection
from app.services import payment_intents
from app.utils.auth import get_current_staff

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
        
        # Send start_sale to daemon
        try:
            response = await payment_intents.start_sale_on_terminal(intent)
            
            if response.get("success"):
                # Terminal accepted the request → mark as processing
                result = response.get("result") or {}
                kpay_response = (
                    {"timeRef": result["timeRef"]}
                    if isinstance(result, dict) and "timeRef" in result
                    else result
                )
                await payment_intents.update_payment_intent_status(
                    session=session,
                    intent_id=intent.id,
                    status="processing",
                    kpay_response=kpay_response,
                )
                log.info(f"Payment {intent.id} started on terminal, status → processing")
            else:
                # Terminal rejected immediately → mark as failed
                error_msg = response.get("error", "Terminal rejected payment")
                await payment_intents.update_payment_intent_status(
                    session=session,
                    intent_id=intent.id,
                    status="failed",
                    error_message=error_msg,
                )
                log.warning(f"Payment {intent.id} failed immediately: {error_msg}")
        
        except RuntimeError as e:
            # Daemon timeout or disconnected mid-request
            error_msg = f"Terminal communication error: {str(e)}"
            await payment_intents.update_payment_intent_status(
                session=session,
                intent_id=intent.id,
                status="failed",
                error_message=error_msg,
            )
            log.error(f"Payment {intent.id} failed: {error_msg}")
        
        # Return intent ID for frontend to poll
        return KPayStartResponse(
            id=intent.id,
            out_trade_no=intent.out_trade_no,
            status=intent.status,
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
