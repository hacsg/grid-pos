# Handoff: Transactions page (lookup, reprint chit/receipt, refund/void)

> Handoff doc for a coding agent. Nothing here is implemented yet. Context: the
> POS is live at an outlet using KPay (WiFi mode) for card/PayNow. Checkout,
> receipt printing, kitchen chit, cash drawer, loyalty, and vouchers are done.
> This spec adds a **Transactions page**: staff look up a past order to
> **reprint the kitchen chit or receipt**, and a manager can **void or refund**
> a card payment from a deliberate, hard-to-mishit location (NOT the checkout
> screen).
>
> **Workflow:** commit directly to `main` and push after each work item. Verify
> with `npx tsc --noEmit` + `npm run build` in `pos-web/`, and
> `.venv/bin/python -m pytest tests -q` (or `python3 -m pytest tests -q`) in
> `backend/`.
>
> **Two prerequisites blocking a clean build (do these FIRST — details below):**
> 1. Order items carry `product_id` but **no product name**; reprint needs
>    names. Add `product_name` to the order-item response.
> 2. The receipt + chit builders are trapped inside `PaymentModal.tsx` and are
>    coupled to `ReceiptSnapshot`/`CartItem`. Extract them to a shared module
>    that takes a normalized shape, so checkout and this page print identically.

## Context / current state (verified 2026-07-07)

**Backend — everything needed already exists:**
- `GET /api/orders` — list with filters `outlet_id, staff_id, status, date_from,
  date_to, limit (≤500), offset`; returns `OrderSummaryRead[]` ordered
  `created_at DESC`. Dates are SGT business days.
- `GET /api/orders/today` — today's SGT orders (compact).
- `GET /api/orders/{order_id}` — `OrderRead` **with items**.
- `GET /api/orders/{order_id}/refunds` — `RefundRead[]` (audit trail).
- `POST /api/kpay/void` (`KPayReversalRequest{order_id, amount?}`) — **same-day
  reversal before settlement**. Manager-gated. Needs a *successful card* intent
  on the order. Daemon injects the KPay manager password; this calls
  `/v2/pos/sales/cancel` on the terminal.
- `POST /api/kpay/refund` (`{order_id, amount?}`) — **refund after settlement**,
  **supports partial** (omit `amount` for full). Manager-gated. Calls
  `/v2/pos/refund`. Backend already prevents over-refund (tracks
  `refunded_amount_for_order`) and marks the order `refunded`.
- Manager gate: `_ensure_manager` → roles `{admin, manager, supervisor}` pass;
  cashier/kitchen get **403**. The backend is the real gate — the UI just
  mirrors it.

**Frontend — client fns already present:**
- `pos-web/src/api/kpayClient.ts`: `voidCardPayment(orderId)`,
  `refundCardPayment(orderId, amount?)` → both return
  `{result: 'ok'|'failed', out_trade_no, message?}`.
- `pos-web/src/api/client.ts`: `OrderRead` interface (items have `product_id,
  quantity, unit_price, modifiers[], notes` — **no product name**), `getProducts`.
- Routing: `react-router-dom`. `StaffShell` renders `/*`; nav tabs in
  `StaffTabs` (POS → `/`, Vouchers → `/vouchers`); `activeTab` derived from
  `location.pathname`. Customer display is a separate route `/display`.
- Printing (`pos-web/src/utils/printer.ts`): `printReceipt(text: string)` and
  `printKitchenChit(chit: KitchenChit)` — both try granted WebUSB first, then
  the daemon's local print service. `buildKitchenChitPayload` (raw ESC/POS) lives
  here. **The chit prints via the daemon's `/print-raw`; the receipt via
  `/print`.** These are the reprint entrypoints — reuse them as-is.

**Currently missing:** any order-history / transactions UI. The POS shell only
has POS (cart/checkout) and Vouchers.

## Decisions (already made — do not re-litigate)

- **Placement:** a dedicated **Transactions** tab/page, reached from the staff
  nav — NOT a button on the checkout/completion screen. Refund especially must
  be deep enough that it can't be hit by accident mid-sale.
- **Primary jobs, in priority order:** (1) find a past order, (2) reprint its
  **kitchen chit**, (3) reprint its **receipt**, (4) manager **void/refund** a
  card payment.
- **Reprint reuses the exact checkout builders** (same 58mm receipt, same
  big-bold chit) — no second implementation. That's why they must be extracted.
- **Manager-gating:** void/refund actions are shown only to `admin/manager/
  supervisor` (from `session.staff.role`), and the backend enforces it anyway.
  Reprint is allowed for any staff.
- **Void vs Refund are different operations, surfaced by context:**
  - **Void** = same-day, pre-settlement reversal (KPay case 5). Offer it for a
    card/split order paid **today** that isn't already refunded/cancelled.
  - **Refund** = post-settlement, partial-capable (KPay case 14). Offer it for a
    card/split order from a **previous day**, or as the fallback when void isn't
    applicable. When unsure, the backend errors are authoritative — surface them.
  - **Cash/PayNow-manual orders:** there's nothing to reverse on the terminal.
    Out of scope for terminal void/refund; a cash refund is a drawer-open +
    status note (leave a `TODO`, don't build it now).

## Work items (in order)

### 1. Backend: add `product_name` to the order-item response
`OrderItemRead` (in `backend/app/schemas/order.py`) currently exposes only
`product_id`. Reprints need the product name (the chit/receipt say
"2 x Coconut Pandan Waffle"). Add a `product_name: str` field and populate it —
join `Product` when loading an order (see `load_order_or_404` /
`get_order`), or resolve names in the read model. Prefer storing/returning the
name from the order side so a later product rename/delete doesn't corrupt old
receipts. Mirror the field into the frontend `OrderRead.items` type.

**Acceptance:** `GET /api/orders/{id}` returns each item with a non-empty
`product_name`. Add/extend a test in `backend/tests/test_orders.py`.

### 2. Frontend: extract receipt + chit builders into a shared module
Today these live in `pos-web/src/components/PaymentModal.tsx` and take
`ReceiptSnapshot`/`CartItem` (which have `item.product.name`,
`item.modifiers[].modifier_name`):
- `buildReceiptText(receipt, session)` + helpers `receiptRow`, `receiptCenter`,
  `receiptPaymentLines`, `RECEIPT_WIDTH`, `RECEIPT_DIVIDER`, `formatReceiptTime`.
- `buildChit(snapshot): KitchenChit`.

Move them to `pos-web/src/utils/receipt.ts` and change their input to a
**normalized shape** both sources can produce, e.g.:
```ts
interface PrintableOrder {
  orderNumber: string;
  createdAt: string;               // ISO
  items: { quantity: number; name: string; modifiers: string[] }[];
  totals: { total: number; discount: number; voucherDiscount: number };
  payment: { method: string; cashAmount: number; cardAmount: number;
             voucherAmount: number; cdcAmount: number; changeDue: number;
             paynowConfirmedAt?: string | null };
  outlet: { name: string; brandName?: string | null;
            companyDetails?: string | null };
}
```
Then:
- Checkout: map its `ReceiptSnapshot` → `PrintableOrder` (thin adapter) and call
  the shared builders. **Behaviour must not change** — verify the printed
  receipt/chit are byte-identical before/after (diff the built string).
- Transactions page: map `OrderRead` (+ outlet from session) → `PrintableOrder`.

Keep the builders pure so they stay trivially testable.

### 3. Frontend: API client for the page
Add to `pos-web/src/api/client.ts`:
- `listOrders(params)` → `GET /api/orders` (support `date_from/date_to`,
  `status`, `limit`, `offset`) and/or `getTodayOrders()` → `/api/orders/today`.
- `getOrder(id)` → `GET /api/orders/{id}` (already returns items; now with
  `product_name` after item 1).
- `getOrderRefunds(id)` → `GET /api/orders/{id}/refunds`.
`voidCardPayment` / `refundCardPayment` already exist in `kpayClient.ts`.

### 4. Frontend: the Transactions page + route + nav
- New component `pos-web/src/components/TransactionsPage.tsx`.
- Add a `Transactions` tab in `StaffTabs` (→ `/transactions`) and a
  `<Route path="/transactions" ...>` in `StaffShell`. Extend the `activeTab`
  union to include `'transactions'`.
- **List view:** default to **today** (`/orders/today`); a date filter and an
  order-number search on top. Each row: order number, time (SGT), total, payment
  method, status badge (paid/refunded/cancelled). Touch-friendly rows (this is
  the same finger-driven till). Ordered newest first.
- **Detail view (tap a row):** items with modifiers and line totals, the
  payment breakdown, status, and any prior refunds (`/refunds`). Action buttons:
  - **Reprint chit** — always available. Build `PrintableOrder` → `buildChit` →
    `printKitchenChit`. Toast on success/failure.
  - **Reprint receipt** — always available. `buildReceiptText` → `printReceipt`.
  - **Void** / **Refund** — **manager-only** (hide if `session.staff.role` not in
    `admin/manager/supervisor`), only for card/split orders, behind a
    confirmation dialog showing the amount. Refund offers a partial-amount input
    (default = full). On success, refresh the order (status → refunded) and show
    the updated refunds list. Surface backend error messages verbatim (e.g.
    "No successful card payment found", over-refund, 403).

### 5. Reprint correctness
- The chit is prep-only (big/bold items+modifiers, no prices) — already how
  `buildChit` works; just feed it the past order's items.
- The receipt reprint should visually match the original (branding, 58mm, no
  subtotal/tax per the current design). Because it's a reprint, consider a small
  "REPRINT" marker line so the kitchen/customer copy isn't mistaken for the
  original — confirm with the owner before adding; leave it out if unsure.

## Data shapes / gotchas

- **Money fields come as `number | string`** across the API — coerce with the
  existing `money()` helper before arithmetic/formatting.
- **Times:** `created_at` is UTC ISO; display in SGT
  (`toLocaleTimeString('en-SG', {hour12:false})`), matching the rest of the POS.
- **Void vs refund availability** is ultimately the backend's call — don't
  over-engineer the client guard; try the action and show the error if the
  backend refuses. Do hide the buttons entirely for non-managers and for
  cash/PayNow-manual orders.
- **Daemon dependency:** void/refund require the KPay daemon connected (backend
  returns 503 "Daemon not connected" otherwise) — surface that clearly.

## Testing / verification

- `backend`: item 1 test (product_name present). Existing order/kpay tests must
  stay green.
- `pos-web`: `npx tsc --noEmit` + `npm run build` clean. Extract (item 2) is the
  risky change — before/after, print one checkout receipt and one chit and
  confirm the generated strings are identical (log them or unit-test the
  builders against a fixed `PrintableOrder`).
- Manual on the POS PC (Chrome): open Transactions → today's list loads → tap an
  order → **Reprint chit** and **Reprint receipt** both print via the daemon →
  as a manager, **Refund** a card order (once KPay production creds exist and a
  real successful card sale is available) and confirm the order flips to
  refunded and the refund appears in the list; as a cashier, confirm the
  void/refund buttons are absent.

## Out of scope
- Cash/PayNow-manual refunds (drawer + status only) — leave a `TODO`.
- Editing/reopening a past order, adding items to it.
- Any change to KPay void/refund backend logic — it's built and reviewed; only
  add the UI entry point.
- Pagination beyond simple `limit/offset` + date filter (fine for one outlet's
  daily volume).

## Done criteria
1. `npx tsc --noEmit` and `npm run build` clean in `pos-web/`; backend pytest
   green including the new `product_name` test.
2. A Transactions tab lists today's orders, filterable by date and searchable by
   order number; tapping an order shows its detail.
3. Reprint chit and reprint receipt work from a past order and match the
   checkout output.
4. Manager can void (same-day) and refund (partial/full) a card order; cashiers
   cannot see those actions; backend 403/erros are surfaced.
5. Commits pushed to `main`, one per work item (or tight group).
