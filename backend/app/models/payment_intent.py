"""Payment intent model for KPay terminal integration."""

from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, JSON, Numeric, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.database import Base

# At most one *active* payment intent per order: a card sale can't start for an
# order that already has one pending/processing or that already succeeded. failed
# / timeout / cancelled intents are excluded so a genuine retry can start fresh.
# Mirrors migrations/0019_idempotency_keys.sql; defined here too so SQLite test
# databases (built via metadata.create_all) enforce the same guard.
_ACTIVE_INTENT_PREDICATE = "status IN ('pending', 'processing', 'success')"


class PaymentIntent(Base):
    """Tracks KPay payment transaction lifecycle.

    States: pending → processing → success/failed/timeout/cancelled

    Frontend polls GET /api/kpay/status/{id} to track payment progress.
    Background service polls KPay terminal (via WebSocket to daemon) until terminal state.
    """

    __tablename__ = "payment_intents"

    __table_args__ = (
        Index(
            "uq_payment_intents_active_per_order",
            "order_id",
            unique=True,
            sqlite_where=text(_ACTIVE_INTENT_PREDICATE),
            postgresql_where=text(_ACTIVE_INTENT_PREDICATE),
        ),
    )

    # Primary key and references
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    outlet_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False)
    order_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    
    # KPay transaction reference (unique across all terminals)
    out_trade_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    
    # Amount in currency units (e.g., SGD 100.50 → 100.50)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    
    # Payment status: pending | processing | success | failed | timeout | cancelled
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    
    # Last KPay API response (full JSON blob for debugging)
    kpay_response: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Error message if payment failed
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
