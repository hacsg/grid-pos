# HANDOFF — P0 CRITICAL (security holes & double-charge risk)

**Repo:** `grid-pos` monorepo — FastAPI backend (`backend/`), React POS (`pos-web/`), Go payment daemon (`services/kpay-daemon/`).
**Audience:** coding agent. This file is self-contained; you do not need any other document.
**Scope of this file:** authentication/authorization holes, client-controlled money, JWT hardening, and the double-charge failure modes. Do NOT fix atomicity/rounding issues here — those are in `HANDOFF_P1_HIGH.md`. Do NOT touch dead code / UX — that is `HANDOFF_P2_MEDIUM.md`.

## System context you need

- **Checkout path:** POS (`pos-web`) builds a cart, calls `POST /api/orders` to create a `pending` order, runs payment (cash / KPay card terminal via the Go daemon / manual PayNow / split), then calls `PUT /api/orders/{id}/status` to mark it `paid`. Receipt is printed client-side.
- **Card payments:** `POST /api/kpay/start` creates a `PaymentIntent`, the FastAPI backend forwards a `start_sale` command over a WebSocket to a Go daemon on the cashier PC, the daemon talks to the physical KPay terminal, and the call blocks until a terminal result returns.
- **Auth:** JWT bearer tokens issued by `POST /api/auth/login`. Dependency `get_current_staff` in `backend/app/utils/auth.py` validates the token and returns a `Staff`. `require_role(...)` wraps it for role checks. Roles: `admin`, `manager`, `supervisor`, `cashier`, `kitchen` (see `app/models/staff.py`).
- **Tests:** `cd backend && python -m pytest`. In-memory SQLite. `tests/conftest.py` provides token fixtures (`admin_token`, `manager_token`, `supervisor_token`, `cashier_token`) and a `client` fixture. Authenticated calls pass `headers={"Authorization": f"Bearer {token}"}` (see `tests/test_staff.py:88-96`).

---

## Issue 1.1 — The entire orders API (and loyalty/reports/etc.) is UNAUTHENTICATED

`backend/app/routers/orders.py` has **no** `Depends(get_current_staff)` on any route. Combined with wildcard CORS in `backend/app/main.py:30-36`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

anyone who can reach the Railway URL can create orders, **mark them paid**, cancel, refund, and apply vouchers (which irreversibly redeems them on the external Plotholders API). The same missing-auth problem affects `routers/loyalty.py` (`POST /loyalty/redeem` burns any member's points), `routers/reports.py` (leaks all revenue), `routers/products.py`, `routers/outlets.py`, `routers/discounts.py`.

**Fix:**

1. Add `current_staff: Staff = Depends(get_current_staff)` to every route in `backend/app/routers/orders.py` (`create_order`, `list_orders`, `list_today_orders`, `get_order`, `update_order_status`, `refund_order`, `add_order_item`, `remove_order_item`, `apply_vouchers_to_order_endpoint`). Import: `from app.models.staff import Staff`, `from app.utils.auth import get_current_staff`.
2. Restrict `refund_order` and the `paid → cancelled` path to managers: use `Depends(require_role(StaffRole.admin, StaffRole.manager, StaffRole.supervisor))` — mirror the role set already used in `routers/kpay.py:31` (`_MANAGER_ROLES = {"admin", "manager", "supervisor"}`).
3. Apply `Depends(get_current_staff)` to all routes in `routers/loyalty.py`, `routers/reports.py`, `routers/discounts.py`. For `routers/products.py` and `routers/outlets.py`, keep `GET` readable by any authenticated staff but require auth (the POS login screen needs the outlet list *before* login — verify `GET /api/outlets` and `GET /api/auth/staff-roster` stay public, since `pos-web/src/components/LoginScreen.tsx` calls them pre-auth; leave those two public and gate everything else).
4. **Lock down CORS** in `main.py`: replace `allow_origins=["*"]` with an explicit allow-list read from settings (add `cors_allow_origins: str` to `app/config.py`, comma-split it), e.g. the deployed POS and admin origins. Keep `allow_credentials=True` only with an explicit list — `"*"` + credentials is itself invalid per the CORS spec and browsers reject it.

**Verification:**
- `cd backend && python -m pytest tests/test_orders.py` — existing tests call `/api/orders` **without** auth (e.g. `tests/test_orders.py:58`), so they will now 401. Update them to pass `headers={"Authorization": f"Bearer {cashier_token}"}` and add the `cashier_token` fixture param. A test that does NOT send a token must now assert `resp.status_code == 401`. Add one explicit `test_create_order_requires_auth` asserting 401 with no header.
- Manual: `curl -X POST $API/api/orders -d '{...}'` with no `Authorization` header returns 401.

---

## Issue 1.2 — Money & status are client-controlled (privilege escalation on price)

### 1.2a — Client can create an order born `paid`
`backend/app/schemas/order.py:44-58`:

```python
class OrderCreate(BaseModel):
    ...
    status: OrderStatus = OrderStatus.pending   # <-- accepts ANY status from client
    ...
    loyalty_discount: Money | None = Field(default=None, ge=0)  # <-- unvalidated discount
```

A client can POST `status="paid"` and skip all payment validation. **Fix:** remove `status` from `OrderCreate` entirely and force `status=OrderStatus.pending` in `create_order` service (`app/services/orders.py:229-249`). Orders may only leave `pending` via the status endpoint.

### 1.2b — Negative/zero totals at creation
`backend/app/services/orders.py:257-259`:

```python
order.subtotal = quantize_money(subtotal)
discount = payload.loyalty_discount or Decimal("0.00")
order.total = quantize_money(subtotal - discount)   # <-- no floor at 0; client discount unbounded
```

**Fix:** clamp: `order.total = max(Decimal("0.00"), quantize_money(subtotal - discount))`, and reject `loyalty_discount > subtotal` with `HTTP 400`. (The in-place recalc path `_recalculate_order_totals` at `orders.py:137-140` already floors at 0 — make creation consistent with it.)

### 1.2c — KPay charges a client-supplied amount never checked against the order
`backend/app/routers/kpay.py:60-67` + `108-173`. `KPayStartRequest.amount` is charged directly; the order is never loaded to verify it exists, is `pending`, belongs to this outlet, or that `amount == order.total`:

```python
class KPayStartRequest(BaseModel):
    order_id: str = Field(..., description="Order ID to link payment to")
    amount: float = Field(..., gt=0, description="Payment amount (e.g., 100.50)")
```

**Fix:** in `start_payment`, before creating the intent, load the order:
```python
order = await session.get(Order, request.order_id)
if order is None:
    raise HTTPException(404, "Order not found")
if str(order.outlet_id) != outlet_id:
    raise HTTPException(403, "Order does not belong to this outlet")
if order.status != OrderStatus.pending:
    raise HTTPException(409, "Order is not payable")
```
For a full-card payment, require `Decimal(str(request.amount)) == order.total`. For split payments the card leg is a partial amount, so instead assert `0 < amount <= order.total` and (P1 will tighten this against the split breakdown). Reject a mismatch with `HTTP 400 "Charge amount does not match order"`. Use `Decimal(str(request.amount))` — never float compare.

### 1.2d — "Paid by card" is an unverified client claim
`PUT /api/orders/{id}/status` accepts `payment_method="card"` with no check that a successful `PaymentIntent` exists for the order (`routers/orders.py:127-171` → `services/orders.py:307`). **Fix:** in `update_order_status_service`, when transitioning to `paid` with `payment_method` in `("card",)` (and the card leg of `split`), require a successful intent:
```python
from app.services.payment_intents import get_successful_intent_for_order
if new_status == OrderStatus.paid and effective_payment_method in ("card", "split"):
    # split only when card_amount > 0
    intent = await get_successful_intent_for_order(db, str(order_id))
    if intent is None:
        raise HTTPException(409, "No successful card payment on record for this order")
```
(Cash / manual-PayNow legs are exempt — they have no terminal intent.)

**Verification:**
- `cd backend && python -m pytest tests/test_orders.py tests/test_kpay.py`.
- Add tests: (1) `POST /api/orders` with `status="paid"` → order comes back `pending` (or 422 if you make it a rejected field); (2) `loyalty_discount` greater than subtotal → 400; (3) `POST /api/kpay/start` with `amount` ≠ `order.total` → 400; (4) `PUT .../status` to `paid` with `payment_method="card"` and no intent → 409.

---

## Issue 1.3 — JWT / auth hardening

`backend/app/config.py:18` ships a default secret with no production guard:

```python
jwt_secret: str = Field(default="change-me-in-local-dev", alias="JWT_SECRET")
```

PIN login (`backend/app/routers/staff.py:87-137`) has no rate-limit or lockout, and `/api/auth/staff-roster` publicly enumerates staff names — a 4–6 digit PIN is brute-forceable. Daemon token is passed in the WebSocket **query string** (`app/routers/ws_daemon.py:105-115`), which leaks into proxy/access logs.

**Fix:**
1. **Fail fast on default secret in prod.** In `config.py`, add a validator: if `environment != "development"` and `jwt_secret == "change-me-in-local-dev"` (or empty), raise at startup. Do the same for `kpay_daemon_token` (default is `""` — an empty shared secret means the WS `secrets.compare_digest(token, "")` accepts a blank token; reject empty in non-dev).
2. **Rate-limit login.** Add a simple per-(outlet_id, source-IP) attempt counter with lockout (e.g. 5 failures → 60s cooldown) in `login_staff`. A lightweight in-memory `dict[str, (count, reset_at)]` is acceptable given the documented single-worker deployment (`railway.toml` pins `--workers 1`); note in a comment it must move to Redis if workers scale.
3. **Move the daemon token out of the query string.** Accept it via a header on the WS upgrade (`Authorization` or `X-Daemon-Token`) in `ws_daemon.py`, and update the daemon's upgrade request in `services/kpay-daemon/daemon/ws.go:~115` (the `GET %s HTTP/1.1 ...` handshake string) to send that header. Keep query-string support temporarily only if you must, behind a deprecation comment.

**Verification:**
- `cd backend && ENVIRONMENT=production python -c "from app.config import Settings; Settings()"` → must raise when `JWT_SECRET` is unset/default.
- Add `test_login_lockout_after_repeated_failures` in `tests/test_staff.py`: 6 bad PINs → 429 (or 401 with lockout message) on the 6th.
- Rebuild the daemon: `cd services/kpay-daemon && go build ./...` must succeed after the handshake change.

---

## Issue 2.1 — Every payment retry creates a NEW order (orphan orders, burned vouchers/points)

`pos-web/src/components/PaymentModal.tsx:662-793`. `completePayment()` calls `createPendingOrder()` unconditionally at the top of **every** attempt (`PaymentModal.tsx:683`):

```javascript
const pendingOrder = await createPendingOrder(paymentReference, voucherCodes, mode);
```

`createPendingOrder` (`PaymentModal.tsx:545-585`) also redeems loyalty **before** payment (`redeemLoyalty` at line 572) and applies vouchers. So if the KPay start, the mark-paid, or anything else fails, the retry:
- leaves an **orphan `pending` order** (one per click),
- re-sends `voucher_codes` that were already redeemed → backend 409 "already redeemed" → checkout dead-ends with the customer's voucher gone,
- has already burned loyalty points with no reversal.

The backend **already supports idempotency keys** on `POST /orders`, `PUT /status`, and `POST /kpay/start` (via the `Idempotency-Key` header — see `backend/app/services/idempotency.py` and the routers), but **the frontend never sends one** (`pos-web/src/api/client.ts`, `kpayClient.ts` send no such header).

**Fix (frontend, `PaymentModal.tsx`):**
1. Create the pending order **once** per checkout and store it in component state (e.g. `const [pendingOrder, setPendingOrder] = useState<OrderRead | null>(null)`). On retry, reuse the existing order id instead of calling `createPendingOrder` again. Only create a new order after a *successful* sale resets the modal (the `open` effect at `PaymentModal.tsx:233-250` already clears state on close — clear `pendingOrder` there too).
2. Generate a stable idempotency key per checkout attempt (e.g. `crypto.randomUUID()` stored in state) and thread it through as an `Idempotency-Key` header. Extend `createOrder`, `updateOrderStatus` (`client.ts:443-464`) and `startCardPayment` (`kpayClient.ts:11-20`) to accept an optional `idempotencyKey` and set it: `headers: { 'Idempotency-Key': key }`.
3. Move loyalty redemption (`redeemLoyalty`, currently `PaymentModal.tsx:571-573`) and voucher application to run **only after** payment succeeds — i.e. in the success branch (`PaymentModal.tsx:451-495` for card, and the cash/manual branches) — OR keep them at order creation but make the whole thing idempotent+reused so a retry doesn't re-run them. Reusing the same order id (step 1) already prevents re-redemption because vouchers are attached to that one order.

**Verification:**
- Manual/e2e: with the terminal forced offline mid-card-sale, click "Charge to terminal", let it fail, click retry → confirm in the DB (`SELECT count(*) FROM orders WHERE ...`) that **one** order exists, not two, and the voucher is still attached/valid.
- Add a frontend check: log the order id on create; the second attempt must log the same id.
- Backend regression: `python -m pytest tests/test_orders.py -k idempoten` (add a test asserting two `POST /orders` with the same `Idempotency-Key` return the same order id and only one row is inserted).

---

## Issue 2.2 — KPay "timeout" can DOUBLE-CHARGE the customer

The Go daemon does one blocking `Sales` then a **single** `Query` (`services/kpay-daemon/daemon/handler.go`, `startSale`):

```go
func (h *Handler) startSale(ctx context.Context, c Command) []any {
	if err := h.client.Sales(ctx, c.OutTradeNo, c.AmountCents, c.PaymentType); err != nil { return []any{errEvent(c.RequestID, err)} }
	return append([]any{map[string]any{"type": "sale_started", ...}}, h.query(ctx, c, "sale_result")...)
}
```

If the terminal is still processing (KPay `payResult == 1`, "still pending" — common for PayNow QR where the customer is slow), `finalize_sale` maps it to status `timeout` (`backend/app/services/payment_intents.py:237-247`):

```python
status_value = "timeout" if code in (-1, 1) else "failed"
```

`timeout` is **excluded** from `ACTIVE_INTENT_STATUSES` (`payment_intents.py:99-102`) and from the `uq_payment_intents_active_per_order` partial unique index, so the cashier's retry starts a **second sale while the first may still settle**. The UI even nudges them to retry (`PaymentModal.tsx:141-149`, "Try again or choose another payment method"). Same loss-of-truth when the daemon disconnects mid-sale (`ws_daemon.py:167-170` fails the pending future with "Daemon disconnected"; the terminal keeps going, the result is lost). Note: a `query` command exists in the daemon but **no backend code path ever calls it** to reconcile.

**Fix:**
1. **Query before allowing a retry.** Add a backend endpoint `POST /api/kpay/reconcile` (or fold into `start`) that, given an `order_id` with a `timeout`/daemon-error intent, sends a `query` command to the daemon for that intent's `out_trade_no` and updates the intent to its true terminal state (`success`/`failed`) before any new sale is permitted. Wire `send_to_daemon(outlet_id, "query", {"out_trade_no": ...})` — the daemon already handles `"query"` (`handler.go`).
2. **Block a fresh sale while a prior intent is unresolved.** In `start_payment` (`routers/kpay.py:145-179`), treat `timeout` intents for the same order as blocking until reconciled: either 409 "previous payment unresolved — reconcile first", or auto-reconcile inline and return the resolved status.
3. **Frontend:** on `timeout`, do NOT offer a bare "retry"; call reconcile first and only surface retry if reconcile confirms `failed`. Update the messaging at `PaymentModal.tsx:141-149` and the processing-screen copy (`PaymentModal.tsx:1077`).

**Verification:**
- `python -m pytest tests/test_kpay.py`. Add a test: create an intent, simulate a daemon `query_result` with `pay_result=1` → intent becomes `timeout`; then a second `POST /kpay/start` for the same order → 409 (not a new intent). After reconcile returns `pay_result=2`, the order is marked and no second sale is possible.
- Manual: force a slow PayNow (`payResult=1`) and confirm the cashier cannot trigger a second charge.

---

## Issue 2.3 — Card charged but order left `pending` forever

On terminal success the backend only stamps `payment_method`/`payment_reference` on the order — it does **not** mark it `paid`. `backend/app/services/payment_intents.py:142-154`:

```python
if status == "success":
    ...
    order_stmt = update(Order).where(Order.id == intent.order_id).values(
        payment_method="card",
        payment_reference=reference,
    )
    await session.execute(order_stmt)   # <-- status NOT set to paid
```

Marking `paid` is left to a **separate** frontend `PUT /status` call (`PaymentModal.tsx:471-473`). If the browser crashes or that call fails, the money is captured but the order is stuck `pending` forever. The UI shows "Payment approved, but order finalization failed" (`PaymentModal.tsx:486-492`) with **no** finalize-retry button — the only visible retry is the 2.1 path that creates a duplicate order.

**Fix:**
1. When `update_payment_intent_status(status="success")` runs, also transition the order to `paid` server-side in the same transaction, going through the same validation used elsewhere (set `order.status = OrderStatus.paid`, stamp `card_amount`/`payment_reference`). This makes the backend the source of truth: a successful intent ⇒ a paid order, no second network round-trip required. Guard it so a `split` order (where the card leg is only part of the total) is NOT auto-marked paid — only full-card orders. For split, keep the existing `PUT /status` finalize but make it idempotent (P0 2.1 idempotency key) and recoverable.
2. Frontend: since full-card orders are now paid by the backend, the success branch (`PaymentModal.tsx:451-495`) should treat the order as already paid (re-fetch it) rather than issuing another mutation. Provide an explicit "Finalize order" retry button in the "finalization failed" error state that re-fetches/re-marks rather than re-creating.

**Verification:**
- `python -m pytest tests/test_kpay.py`. Add a test: a `sale_result` with `pay_result=2` (success) for a full-card order → the linked order's `status == "paid"` and `payment_reference` set, with no separate `PUT /status` call.
- Manual: complete a card sale, then kill the browser tab immediately after approval; reload and confirm the order shows `paid` (not `pending`).

---

## Suggested order of work
1.1 (auth + CORS) → 1.2 (server-side money authority) → 2.3 (backend marks paid) → 2.1 (order reuse + idempotency keys) → 2.2 (timeout reconcile) → 1.3 (hardening). Do 2.3 before 2.1 because once the backend marks full-card orders paid, the frontend retry logic in 2.1 gets much simpler.

**Run the full backend suite before handing back:** `cd backend && python -m pytest`.
