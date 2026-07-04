# Handoff: Cash-drawer kick, receipt-print hardening, test cleanup

> Handoff doc for a coding agent. Nothing here is implemented yet. Context: the P0–P2 payment
> handoffs are done and verified (KPay card flow reviewed end-to-end 2026-07-04; a missing
> `settings` import in `backend/app/routers/kpay.py` was found and fixed in `2a33260c`).
> This spec covers the remaining gaps: the cash drawer never opens, receipt printing is
> unverified/fragile, and there is stale test debt.
>
> **Workflow:** commit directly to `main` and push after each work item. Verify with
> `npx tsc --noEmit` + `npm run build` in `pos-web/`, and
> `.venv/bin/python -m pytest tests -q` in `backend/`.
>
> **Hard constraint:** you cannot test against real hardware (printer, drawer, terminal).
> Keep hardware I/O isolated in `pos-web/src/utils/printer.ts` so the pure parts (payload
> bytes, when-to-fire logic) are unit-testable, and leave the on-site checklist at the bottom
> of this file intact for the humans.

## Context / current state

- Receipt printing exists: `pos-web/src/utils/printer.ts` (WebUSB, ESC/POS plain text +
  `GS V 0` full cut), triggered manually by the "Print receipt" button on the payment
  completion screen (`PaymentModal.tsx` → `printReceipt()` ~line 983). A printer
  connect/forget settings surface already exists in `App.tsx:697-712`.
- **No cash-drawer kick exists anywhere in the repo** (verified by grep 2026-07-04). Cash
  checkout marks the order paid and shows change — the drawer stays shut.
- The drawer is wired to the receipt printer's RJ11 port (standard setup); it opens when the
  printer receives an ESC/POS pulse command. No separate device or driver.
- Backend test debt: `backend/tests/test_loyalty.py` imports `app.models.loyalty`, which was
  deleted in `b0675680` (loyalty consolidated to Plotholders) — the file cannot even be
  collected. Two Plotholders tests fail flakily (details in item 5). Six `.pyc` files are
  tracked in git despite `**/__pycache__/` being in `.gitignore` (ignore was added after they
  were committed).

## Decisions (already made — do not re-litigate)

- **Drawer opens automatically** when a payment that includes cash completes (pure cash, or
  split with a cash leg > 0). Also opens on a **manual "Open drawer" button** next to
  "Print receipt" on the completion screen. No settings toggle for v1.
- **Receipt printing stays manual** (button). No auto-print in this handoff.
- Drawer-kick failure must **never block or fail the payment flow** — the order is already
  paid by the time the drawer fires. Failure = one `toast.error`, nothing else.
- Kick command: `ESC p 0 25 250` = `\x1b\x70\x00\x19\xfa` (pin 2, 50 ms on / 500 ms off).
  Expose the pin as a parameter defaulting to 0 so pin 5 (`\x01`) can be tried on-site
  without a code change (e.g. read from a `localStorage` key `grid_pos_drawer_pin`, default 0).
- No local print-service fallback in this handoff. If the on-site test shows WebUSB cannot
  claim the device, that becomes its own follow-up spec (candidate: tiny HTTP print endpoint
  on the PC that already runs the KPay daemon).

## Work items (in order)

### 1. `openCashDrawer()` in printer.ts

Refactor `sendToDevice(device, text)` into a byte-oriented core:
`sendBytes(device, payload: Uint8Array)`, with the existing text path building
`ESC @` (init) + sanitized text + `\n\n\n\n` feed + `GS V 0` cut on top of it. Then:

```ts
export async function openCashDrawer(pin: 0 | 1 = drawerPinFromStorage()): Promise<boolean> {
  // ESC p <pin> 25 250 — pulse the RJ11 drawer port on the receipt printer.
  const payload = new Uint8Array([0x1b, 0x70, pin, 0x19, 0xfa]);
  // resolve granted device exactly like printReceipt(); return false on any failure
}
```

Notes:
- Prepend `\x1b\x40` (ESC @, initialize) to *print* payloads only — not the drawer pulse.
- Sanitize print text to ASCII before encoding (`TextEncoder` is UTF-8; ESC/POS default
  codepage garbles multi-byte chars — replace non-ASCII with `?` or closest ASCII).
- Unit-test the payload builders (byte sequences) — extract them as pure functions.
  `pos-web` has no test runner configured; add `vitest` (it's a Vite app, zero-config) with
  a single `printer.payload.test.ts`, or if adding a runner proves disruptive, verify via
  `tsc` and keep the builders pure and trivially reviewable.

### 2. Fire the drawer on cash payments (PaymentModal.tsx)

In `completePaidOrder(...)` (~line 505), after the receipt snapshot is set: if
`snapshot.cashAmount > 0 || snapshot.changeDue > 0 || paidMode === 'cash'`, call
`void openCashDrawer().then((ok) => { if (!ok) toast.error('Cash drawer did not open'); })`.
Do not `await` it in the payment path.

Add a manual button on the completion footer (~line 1421, next to "Print receipt"):
"Open drawer" with the same failure toast. Render it only when `isPrintingSupported()`.

**Acceptance:** cash and split-with-cash completions attempt the kick exactly once; card-only
and PayNow-only completions do not; a failed kick shows a toast and the completion screen is
otherwise unaffected.

### 3. Broaden the WebUSB device picker

`connectPrinter()` and the `printReceipt()` fallback prompt filter on `{ classCode: 7 }`.
Many budget ESC/POS printers enumerate as vendor-specific (class 0xFF) and never appear.

- In `connectPrinter()` (used by the App.tsx settings surface): try `{ filters: [{ classCode: 7 }] }`;
  if the user cancels or no device matches, retry once with `{ filters: [] }` (WebUSB treats an
  empty filter list as match-all — verify in Chrome; if it throws, fall back to a broad
  vendor-class filter list). Surface this as a "Show all USB devices" affordance rather than
  an automatic silent retry if that's cleaner in the existing UI.
- `sendToDevice` currently picks the first interface with an OUT endpoint — keep that, but
  prefer an interface of class 7 or 0xFF over e.g. a config/DFU interface when several match.

**Acceptance:** a printer that doesn't advertise class 7 can still be selected and saved from
the settings surface.

### 4. Print-path polish (small)

- `buildReceiptText` in `PaymentModal.tsx` already produces the receipt; leave content as-is.
- Wrap the print call so a second tap while a print is in flight doesn't interleave USB
  transfers (a simple in-flight boolean in printer.ts).
- After a successful manual print, `toast.success('Receipt sent to printer')` — currently
  success is silent, so cashiers double-tap.

### 5. Backend test cleanup

- **Delete `backend/tests/test_loyalty.py`** — it imports `app.models.loyalty`, removed in
  `b0675680`. The loyalty flows it covered now live behind Plotholders
  (`test_plotholders_routes.py` covers the proxy).
- **Fix the two flaky Plotholders tests**:
  `test_orders.py::TestCreateOrder::test_create_with_customer_id_records_plotholders_purchase`
  and `test_plotholders_routes.py::test_signup_with_plotholders_fields_proxies_to_plotholders`.
  Symptom: the first fails with `KeyError: 'order_id'` in isolation and a regex `TypeError`
  in the full run — the fake `record_purchase` sees an empty/partial payload, which smells
  like the purchase recording is fired as a background task the test doesn't await (or a
  fixture-ordering leak). Find the root cause and make them deterministic — do not just mark
  them `xfail`.
- **Untrack the committed bytecode:** `git rm -r --cached backend/app/**/__pycache__` (6 files;
  `.gitignore` already covers them going forward).

**Acceptance:** `pytest tests -q` → 0 failures, 0 collection errors, and `git ls-files | grep -c '\.pyc$'` → 0.

## Out of scope

- Auto-print on payment completion (manual button only).
- Local print-service / driver fallback (separate spec if on-site WebUSB test fails).
- Any KPay/terminal changes — that flow is reviewed and working; don't touch it.
- Settings UI for drawer pin beyond the `localStorage` key.

## Done criteria

1. `npx tsc --noEmit` and `npm run build` clean in `pos-web/`; backend pytest fully green.
2. Grep proof: `openCashDrawer` exists and is called from exactly two places
   (auto on cash completion, manual button).
3. Commits pushed to `main`, one per work item (or tight group).

---

## On-site hardware checklist (for humans — agent: leave this section intact)

Do this at the outlet with the real printer + drawer + POS PC:

1. **Driver check (Windows):** if the printer was installed with a Windows driver,
   Chrome WebUSB may be unable to claim it (`claimInterface` fails / device missing from
   picker). If so: replace the USB driver with WinUSB using Zadig (zadig.akeo.ie), pointing
   at the printer's interface. Note: this disables normal Windows printing to that device.
2. In the POS, open printer settings (existing connect flow in the top bar) → pick the
   printer → print a test receipt from a completed sale. Check: text legible, width fits
   80 mm, paper cuts.
3. Cash sale end-to-end: complete a cash payment → drawer should pop. If not, set
   `localStorage.setItem('grid_pos_drawer_pin', '1')` in DevTools and use the manual
   "Open drawer" button to retest.
4. Card sale end-to-end on the staging terminal (per TEST_PLAN.md): sale → approve → void.
5. Record results here (edit this file): printer model, USB class shown in `chrome://usb-internals`,
   whether Zadig was needed, working drawer pin.
