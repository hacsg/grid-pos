# HANDOFF — P2 MEDIUM (dead code, UX gaps, hardening, non-functional clients)

**Repo:** `grid-pos` monorepo — FastAPI backend (`backend/`), React POS (`pos-web/`), React admin (`admin/`), Android app (`frontend/`), Go daemon (`services/kpay-daemon/`).
**Audience:** coding agent. This file is self-contained.
**Scope:** lower-urgency correctness, refund auditability, receipt/UX gaps, timezone bug, and the two clients that cannot function against the current backend. None of these are "money is leaking right now" — they are "this will bite operations, or it's misleading dead code." Security/double-charge/atomicity are handled in `HANDOFF_P0_CRITICAL.md` and `HANDOFF_P1_HIGH.md`; do not redo those.

## System context you need
- Checkout: POS creates a `pending` order via `POST /api/orders`, pays, then `PUT /api/orders/{id}/status` marks it `paid`. Reports count only `status == "paid"` orders. Order statuses: `pending`, `paid`, `refunded`, `cancelled` (`backend/app/models/order.py:17-23`).
- Tests: `cd backend && python -m pytest`. Frontend builds: `cd pos-web && npm run build`; `cd admin && npm run build`. Android: `cd frontend && ./gradlew assembleDebug`.

---

## 1. Refunds have no audit trail

`POST /api/orders/{id}/refund` accepts a `reason` and passes it to the service, which **silently drops it** (`backend/app/services/orders.py:387-407`):
```python
async def refund_order_service(db, order_id, reason: str | None = None) -> Order:
    order = await load_order_or_404(db, order_id)
    if order.status != OrderStatus.paid:
        raise HTTPException(400, "Cannot refund an order that is not paid")
    order.status = OrderStatus.refunded
    await db.commit()            # reason never persisted; no who/when/amount recorded
```
Same for KPay void/refund (`routers/kpay.py:278-354`): a partial `refund` with an `amount` marks the whole order `refunded` regardless of amount (`routers/kpay.py:352`), and the refunded amount is never stored. A split-order void cancels the entire order even though only the card leg was reversed — the cash leg silently vanishes from the books.

**Fix:**
1. Add a `refunds` table (new migration in `backend/migrations/`, next number after `0019_idempotency_keys.sql`): `id, order_id, staff_id, amount, reason, kind (full|partial|void), created_at`.
2. In `refund_order_service` and the KPay void/refund handlers, insert a refund row (with `staff_id` from the authenticated `current_staff` added in P0-1.1, the `reason`, and the actual `amount`).
3. For partial refunds, do not blindly set `refunded` — if `refund_amount < order.total`, keep the order `paid` and record the partial refund; only mark `refunded` on a full refund. Validate `refund_amount <= order.total - already_refunded`.

**Verification:** `python -m pytest tests/test_orders.py -k refund`. Add a test: refund with a reason → a `refunds` row exists with that reason and amount; a partial refund leaves the order `paid`.

---

## 2. Order numbering & "today" reset at UTC midnight = 8am Singapore

`backend/app/services/orders.py:48-64` (`next_order_number`) and `routers/orders.py:100-118` (`list_today_orders`) both bucket by UTC calendar day:
```python
day_start = datetime.combine(current_time.date(), time.min, tzinfo=UTC)
day_end = day_start + timedelta(days=1)
```
Singapore is UTC+8 and has no DST. So daily order numbers restart at **08:00 local** (mid-breakfast service) and "today's orders" straddles two business days.

**Fix:** introduce a business timezone (add `business_timezone: str = "Asia/Singapore"` to `app/config.py`) and compute day boundaries in that zone, converting to UTC for the query. Use `zoneinfo.ZoneInfo`. Apply the same conversion in `list_orders` date filters (`routers/orders.py:89-94`) and any report day-bucketing in `services/reports.py`.

**Verification:** `python -m pytest tests/test_orders.py tests/test_reports.py`. Add a test: an order created at 00:30 UTC (08:30 SGT) is counted in the same business day as one at 15:00 UTC, and order numbers do not reset at 08:00 SGT.

---

## 3. Receipt is built from cart state, not the server order

`pos-web/src/components/PaymentModal.tsx:151-191` (`buildReceiptText`) and the receipt preview (`PaymentModal.tsx:1134-1229`) render from the in-memory `items`/`totals`, not from the persisted order. Consequences:
- Server-side price/total differences are invisible on the receipt.
- The `Discount -$0.00` line prints even when there is no discount (`PaymentModal.tsx:179`).
- Receipt timestamp is **print time**, not payment time (`new Date().toLocaleString(...)` at `PaymentModal.tsx:174`).
- `GET /api/orders/{id}` does not include applied vouchers — `_enrich_order_response` (`backend/app/routers/orders.py:214-220`) is only wired into the voucher-apply endpoint, so a reprint from order history can never reconstruct voucher lines.

**Fix:**
1. Build the receipt from the paid order returned by the backend (it already returns totals, payment fields, and `applied_vouchers` on the create/apply paths). Use `receipt.order.total` etc. rather than recomputing from cart.
2. Suppress zero-value lines (only print Discount/Vouchers when > 0) — the discount line at `PaymentModal.tsx:179` should be conditional like the voucher line at `180`.
3. Wire `_enrich_order_response` into `GET /orders/{id}` (`routers/orders.py:121-124`) so history reprints include vouchers.

**Verification:** `cd pos-web && npm run build`. Manual: a receipt with no discount shows no discount line; a voucher order reprinted from history shows the voucher lines.

---

## 4. JWT expires mid-shift; cash keeps working, card breaks (confusing)

POS JWTs last 60 min (`backend/app/config.py:20`, `access_token_expire_minutes=60`). `pos-web` has **no** token-refresh call (grep `refresh` in `pos-web/src` returns nothing), and the session in `localStorage` outlives the token. After P0-1.1 gates the orders API, the failure mode becomes: **cash checkout starts 401ing while the session still looks logged in.** (Today, pre-P0, cash silently works because orders are unauthenticated while `/kpay/*` is auth'd — an equally confusing split.)

**Fix:** the backend already exposes `POST /api/auth/refresh` (`routers/staff.py:~145`). In `pos-web/src/api/client.ts`, add an axios response interceptor: on 401, attempt a single refresh, retry the original request once, and only then clear the token + bounce to login. Currently the interceptor at `client.ts:197-217` just deletes the token on 401 with no refresh. Optionally proactively refresh when the token is near expiry.

**Verification:** `cd pos-web && npm run build`. Manual: set `ACCESS_TOKEN_EXPIRE_MINUTES=1`, log in, wait past expiry, complete a sale → it refreshes and succeeds instead of silently 401ing.

---

## 5. Void UX leaves a "paid" receipt on screen

`pos-web/src/components/PaymentModal.tsx:795-814` (`handleVoid`). After a successful void, `voidState` becomes `'voided'` but the receipt still renders as a normal paid receipt (no VOIDED marker), and `onOrderComplete()` already fired (`PaymentModal.tsx:637`) so the sale stays in the day's flow.

**Fix:** when `voidState === 'voided'`, render a clear "VOIDED" banner over the receipt, disable "Print receipt" (or print a void slip), and ensure the completed-sale side effects are reflected as voided. Change the button label logic at `PaymentModal.tsx:1247-1249` is already partly there (`'Close'` vs `'New sale'`) — extend the visual state.

**Verification:** `cd pos-web && npm run build`. Manual: void a card payment from the receipt screen → receipt is clearly marked voided.

---

## 6. Discount metadata is lost (misattributed in reports)

`pos-web/src/components/PaymentModal.tsx:558`:
```javascript
loyalty_discount: totals.discount + totals.loyaltyDiscount > 0 ? totals.discount + totals.loyaltyDiscount : null,
```
Manual/percent discounts are folded into `loyalty_discount`, so reporting attributes promo discounts as loyalty cost, and *which* discount was applied is never recorded on the order.

**Fix:** send the manual discount separately. Add a nullable `manual_discount` (and optionally `discount_id`/`discount_label`) to the `Order` model + `OrderCreate` schema (`backend/app/schemas/order.py:44-58`) and persist it distinctly from `loyalty_discount`. Update `create_order` totals math to subtract both. Update reports to separate the two.

**Verification:** `python -m pytest tests/test_orders.py`; `cd pos-web && npm run build`. A created order records manual discount separately from loyalty discount.

---

## 7. Android app (`frontend/`) is a non-functional prototype — quarantine it

This app cannot perform a real checkout against this backend and is dangerous left unmarked:
- `frontend/app/.../ui/screens/cart/CartScreen.kt:50-58` renders **hardcoded sample gelato items**; cart/order/product data is local Room DB only and never syncs to FastAPI.
- `frontend/app/.../data/api/PaymentApiService.kt` targets `POST /api/payments/connection-token | create-intent | capture` — **none of these endpoints exist** in `backend/` (Stripe was never implemented server-side; grep `payments/` in `backend/app` returns nothing).
- The flow charges real money through Stripe/KPay adapters **without any backend order**, and on success prints a **test receipt** (`frontend/app/.../ui/screens/payment/PaymentViewModel.kt:109` `printRepository.printTestReceipt()`).

**Fix (do NOT try to make it work — quarantine):**
1. Add `frontend/README.md` stating clearly: "UI PROTOTYPE ONLY — not wired to the Grid POS backend, does not create orders, prints a test receipt. Do not deploy. pos-web is the production POS."
2. Strip/rotate any live payment credentials committed in its build config or `PaymentPreferencesManager`/DI modules (`frontend/app/.../di/PaymentModule.kt`, `payments/kpay/KPayCredentials.kt`) so nobody can charge a real card from a debug build. Move secrets to `local.properties` (gitignored) or remove them.
3. Optionally move the whole `frontend/` dir under an `archive/` or `experiments/` path so it's not mistaken for a shippable client.

**Verification:** confirm no live secret literals remain: `grep -rniE "sk_live|app_secret|api_key|password" frontend/app/src` returns only placeholders. The README exists.

---

## 8. Admin Orders page is mock-only — wire it up (it's the incident-recovery tool)

`admin/src/pages/Orders.tsx:9-22` renders a hardcoded `mockOrders` array; filters filter the mocks; the **Refund button has no `onClick`** (`admin/src/pages/Orders.tsx:180-185`):
```javascript
const mockOrders: Order[] = [ { id: '1', order_number: '1042', ... status: 'completed', ... } ];
...
<Button variant="danger" size="sm">   {/* no onClick */}
  <Undo2 className="h-4 w-4" /> Refund
</Button>
```
The real hooks already exist and are unused here: `admin/src/hooks/useOrders.ts` exports `useOrders`, `useOrder`, `useRefundOrder`; `admin/src/api/client.ts:255-273` has `getOrders`/`refundOrder`. Only the Dashboard uses real data. Also note a vocabulary mismatch: admin uses `'completed'` (`Orders.tsx:15,104`) but the backend status is `'paid'` — the filter/badge logic will show nothing for real paid orders until fixed.

**Fix:**
1. Replace `mockOrders` with `useOrders(params)` and drive the status/outlet filters from real query params. Populate the outlet `<select>` (currently hardcoded to "Main Street"/"Downtown" at `Orders.tsx:117-118`) from `useOutlets`.
2. Fix the status vocabulary: use `paid | pending | cancelled | refunded` everywhere (types in `admin/src/types/index.ts` and the badge `colors` map at `Orders.tsx:59-64`). Remove the phantom `completed`/`tax` fields the backend doesn't return.
3. Wire the Refund button to `useRefundOrder().mutate(order.id)` with a confirm dialog; disable it for non-`paid` orders. (Refund authorization/audit is handled backend-side in item 1 above + P0-1.1.)

**Verification:** `cd admin && npm run build`. Manual: the Orders page lists real orders from the API, filters work, and Refund calls `POST /api/orders/{id}/refund` and invalidates the query.

---

## 9. Minor backend hygiene (low risk, do if time permits)

- **Migration numbering is inconsistent** (`backend/migrations/`): mixes `004_`, `0010_`–`0019_` (with `0016` missing), `20241224_*`, and `add_payment_intents.sql`. Verify the ordering logic in `backend/app/migrations.py` (`run_sql_migrations`) applies them in the intended order; normalize to a single zero-padded scheme and document it so a future migration can't be applied out of order.
- **Idempotency table never purged** (`backend/app/services/idempotency.py`): completed keys accumulate forever. Add a periodic cleanup (delete `completed` rows older than N days) — a scheduled job or a startup sweep.
- **Stale docs:** the module docstring in `backend/app/routers/kpay.py:1-9` and `HANDOFF.md` describe the old 2s-polling architecture; the real flow is a synchronous blocking `/start`. Update them so the next reader isn't misled.

**Verification:** `cd backend && python -m pytest` still green after any migration renumbering.

---

## Suggested order of work
1 (refund audit) and 8 (admin orders wiring) together give operations a working way to see and fix orders — highest operational value. 2 (timezone) is a small high-impact correctness fix. 7 (Android quarantine) is quick and removes a real credential-exposure risk. The rest are polish. Run the relevant build/test command listed under each item before handing back.
