# HANDOFF — P1 HIGH (payment integrity & atomicity)

**Repo:** `grid-pos` monorepo — FastAPI backend (`backend/`), React POS (`pos-web/`).
**Audience:** coding agent. This file is self-contained.
**Scope:** money-rounding divergence between client and server, missing DB row locking on state transitions, and cross-system (local DB + external Plotholders loyalty API) voucher/loyalty atomicity. Assumes the P0 fixes (auth, server-side amount authority, backend-marks-paid, order-reuse idempotency) are done or in progress — reference `HANDOFF_P0_CRITICAL.md` but do not redo them here.

## System context you need

- **Money:** all persisted money is `Decimal(10,2)`. Backend rounds with `ROUND_HALF_UP` via `quantize_money` in `backend/app/services/orders.py:34-36` (`CENT = Decimal("0.01")`). The **frontend** computes totals in JS floats (`pos-web/src/App.tsx:250-268`).
- **Split payment:** an order can be paid partly cash, partly CDC voucher, partly card/PayNow, plus applied vouchers. The backend validates the split adds up in `_validate_split_payment_amounts` (`services/orders.py:174-208`).
- **Vouchers:** applied via `apply_vouchers_to_order` (`services/vouchers.py:114-227`). Two sources of truth: local `vouchers`/`order_vouchers` tables AND the external **Plotholders** API (`services/plotholders_client.py`), which is the system of record for issuance/redemption.
- **DB:** PostgreSQL in prod (SQLite in tests). Async SQLAlchemy sessions. Transactions commit via `await db.commit()`.
- **Tests:** `cd backend && python -m pytest`. Fixtures in `tests/conftest.py`; order tests in `tests/test_orders.py`.

---

## Issue 2.4 — Split-payment float rounding can strand a charged card

The frontend computes the card remainder in floats and the backend requires it to equal `order.total` **exactly** with no tolerance.

Frontend (`pos-web/src/components/PaymentModal.tsx:276-306`), floats throughout:
```javascript
const totalDue = roundMoney(totals.total);
const splitCdcAmount = mode === 'split' ? roundMoney(Math.min(Math.max(money(cdcAmount), 0), totalDue)) : 0;
const splitCashCap = roundMoney(Math.max(0, totalDue - splitCdcAmount));
const splitCashAmount = mode === 'split' ? roundMoney(Math.min(Math.max(cashTendered, 0), splitCashCap)) : 0;
const splitTerminalAmount = mode === 'split' ? roundMoney(Math.max(0, totalDue - splitCashAmount - splitCdcAmount)) : 0;
```
where `totals.total` itself came from float math including percent discounts (`App.tsx:256`, `subtotal * (discount.amount / 100)`).

Backend (`backend/app/services/orders.py:193-197`), exact equality:
```python
if quantize_money(cash_amount + card_amount + cdc_amount) != quantize_money(order.total):
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Split cash, CDC and card/PayNow amounts must equal the payable total",
    )
```

**Failure:** the card leg is charged on the terminal *first* (`PaymentModal.tsx:721-741`), THEN `PUT /status` validates the split. A sub-cent divergence (e.g. client `splitTerminalAmount = 3.34` vs backend `order.total - cash - cdc = 3.33`) makes mark-paid 400 **after money is already captured** — unrecoverable without manual DB edits.

**Fix (make the backend authoritative, not the client):**
1. In `update_order_status_service` / `_validate_split_payment_amounts`, do **not** trust the client's `card_amount`. Compute the card leg on the server as the residual:
   ```python
   card_leg = quantize_money(order.total - cash_amount - cdc_amount - applied_voucher_total)
   if card_leg < 0:
       raise HTTPException(400, "Cash + CDC + vouchers exceed the total")
   # use card_leg for validation & persistence; ignore client card_amount (or require it match card_leg exactly)
   ```
2. **The card charge amount must equal this server-computed residual.** Per P0-1.2c the `/kpay/start` amount is validated against the order; for split, validate `amount == card_leg` computed the same way. That guarantees the charged amount and the recorded amount are identical.
3. Unify rounding: the frontend should display but never *decide* money — send raw components (cash tendered, cdc entered) and let the backend derive the card residual. Remove reliance on `roundMoney` (`PaymentModal.tsx:69-71`) for anything sent to the server.
4. **Also unify the rounding mode.** `services/vouchers.py:21-22` uses default (banker's) rounding while `services/orders.py:34-36` uses `ROUND_HALF_UP`. Make `vouchers.quantize_money` use `ROUND_HALF_UP` too so a value never rounds two different ways in one pipeline:
   ```python
   # services/vouchers.py
   def quantize_money(value: Decimal) -> Decimal:
       return value.quantize(CENT, rounding=ROUND_HALF_UP)
   ```

**Verification:**
- `python -m pytest tests/test_orders.py -k split`. Add a test where a percent discount produces a `.xx5`-ish total (e.g. subtotal 10.05, 33% discount) and confirm a split with server-computed card residual is accepted, and that a client-sent mismatched `card_amount` does not cause a false 400.
- Manual: a split order whose remainder lands on a rounding boundary completes without a post-charge 400.

---

## Issue 2.5 — No row locking on status transitions or voucher redemption (concurrent double-apply)

### 2.5a — Status transitions are load → validate → commit with no lock
`backend/app/services/orders.py:307-384` (`update_order_status_service`) and `387-407` (`refund_order_service`):
```python
order = await load_order_or_404(db, order_id)      # plain SELECT
_validate_status_transition(order, new_status)     # checks current status
order.status = new_status
...
await db.commit()
```
Two concurrent mark-paid requests (two cashier tabs, or a stale customer-display tab firing the same action) both read `pending`, both pass `_validate_status_transition`, both commit. Same race on refund.

**Fix:** lock the order row for the duration of the transaction. In `load_order_or_404` add an optional `for_update: bool = False` that appends `.with_for_update()` to the select, and call it with `for_update=True` from `update_order_status_service` and `refund_order_service`. `with_for_update()` is a no-op on SQLite (tests still pass) and takes a real row lock on PostgreSQL, so the second transaction blocks until the first commits and then correctly fails `_validate_status_transition`.

### 2.5b — Voucher "already redeemed" check is an unlocked read-then-write
`backend/app/services/vouchers.py:179-192`:
```python
if voucher.redeemed_at is not None or voucher.order_id is not None:
    raise HTTPException(409, f"Voucher {voucher.code} has already been redeemed")
now = datetime.now(UTC)
voucher.redeemed_at = now
voucher.order_id = order.id
...
```
The unique constraint on `order_vouchers` is only `(order_id, voucher_id)` (`migrations/005_add_vouchers.sql:38`), which does NOT stop the *same voucher* being applied to *two different orders* concurrently — both reads see `redeemed_at IS NULL`, both write.

**Fix:**
1. Lock the voucher row on read: fetch it with `.with_for_update()` in `get_voucher_by_code` (or a locked variant used only in the apply path).
2. Add a DB guarantee: a partial unique index / constraint so a voucher can be redeemed at most once — e.g. `CREATE UNIQUE INDEX uq_voucher_single_redemption ON order_vouchers (voucher_id);` (a voucher may link to only one order). Add this as a new numbered migration in `backend/migrations/` (follow the existing `00NN_name.sql` scheme; the highest is `0019_idempotency_keys.sql`). Handle the resulting `IntegrityError` as a 409.

**Verification:**
- `python -m pytest tests/test_orders.py tests/test_vouchers.py` (if the latter doesn't exist, add it). Add a test that applies the same voucher code to two different order ids and asserts exactly one succeeds and the other 409s.
- On PostgreSQL, the new unique index must reject a second `order_vouchers` row for the same `voucher_id`.

---

## Issue 2.6 — Voucher application is not atomic across local DB and Plotholders

`backend/app/services/vouchers.py:141-221`. Inside the per-code loop, the external redemption fires **before** the local transaction commits, and its failures are swallowed:

```python
for raw_code in codes:
    ...
    link = OrderVoucher(order_id=order.id, voucher_id=voucher.id, amount_applied=amount)
    db.add(link)
    applied.append(link)
    # Also redeem on Plotholders side ...
    try:
        await client.redeem_voucher_by_code(normalized, staff_id, outlet_name or str(order.outlet_id or ""))
    except PlotholdersAPIError:
        pass   # <-- swallowed: locally redeemed, externally still available (or vice-versa)
...
await db.commit()   # <-- commit happens AFTER external side effects
```

Problems:
- **Partial failure:** if a *later* code in the same request raises, the local transaction rolls back but earlier `redeem_voucher_by_code` calls are already permanent on Plotholders → voucher burned, no discount recorded anywhere.
- **Swallowed external failure:** `except PlotholdersAPIError: pass` means the local side says "redeemed" while Plotholders (the system of record) still shows it available — and the reverse when local rolls back after a successful external redeem.
- **Silent $0 amount:** `services/vouchers.py:161-165` falls back to `Decimal("0.00")` if the external amount can't be parsed — a valid voucher silently applies zero discount.
- **No cap:** `amount_applied` is never capped at the remaining order total (`vouchers.py:161-166`), so a $50 voucher on a $10 order records the full $50 as applied even though only $10 of value is usable (and `new_total` floors at 0 at line 217, so the extra $40 is just lost).

**Fix:**
1. **Two-phase ordering:** validate ALL codes first (fetch each from Plotholders, check not redeemed, parse amount) and collect them; then write ALL local `OrderVoucher` rows and commit the local transaction; then, only after the local commit succeeds, call `redeem_voucher_by_code` for each. If any *validation* fails, nothing has been redeemed anywhere. Restructure the single loop at `vouchers.py:141-209` into: (a) validate+collect loop, (b) local persist + commit, (c) external redeem loop.
2. **Do not swallow external redeem failures after commit.** If `redeem_voucher_by_code` fails in phase (c), log it loudly and record the voucher as needing reconciliation (e.g. a `redemption_synced: bool` flag on the voucher row, default False, set True on external success) so a follow-up job/report can retry. Do not silently `pass`.
3. **Fail on unparseable amount** instead of defaulting to 0: if `Decimal(str(amount_raw))` raises or yields 0 for a voucher that should have value, raise `HTTP 422 "Voucher amount could not be determined"` rather than applying a $0 discount (`vouchers.py:161-165`).
4. **Cap applied amount** at the remaining payable: `amount = min(amount, remaining_total)` where `remaining_total` decrements as vouchers are applied, so `amount_applied` reflects real value used.

**Verification:**
- `python -m pytest tests/test_orders.py tests/test_loyalty.py tests/test_plotholders_routes.py` (Plotholders is mocked via a transport in `tests/test_plotholders_client.py` — reuse that pattern).
- Add tests: (1) second code in a multi-code request fails validation → assert NO voucher was redeemed on the (mocked) Plotholders client and the local DB has zero `order_vouchers` rows; (2) unparseable amount → 422; (3) $50 voucher on $10 order → `amount_applied == 10.00` and `order.total == 0`.

---

## Note on loyalty (adjacent, same atomicity class)
`backend/app/services/orders.py:276-284` calls `PlotholdersClient().record_purchase` at **order creation** (status still `pending`), so abandoned/cancelled checkouts accrue loyalty and refunds never reverse it. Moving this to fire on payment success belongs with the P0 order-lifecycle work (2.1/2.3); if you touch `create_order` here, relocate `record_purchase` to the paid transition rather than creation. Flagged so it isn't missed, but keep the primary lifecycle change in the P0 stream to avoid conflicting edits.

## Suggested order of work
2.4 (rounding authority) and 2.6 (voucher atomicity) are the highest customer-money risk; do them first. 2.5 (locking) is a smaller, well-contained change that hardens both. Run `cd backend && python -m pytest` before handing back.
