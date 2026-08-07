# Task 004 — Physical gift cards: POS (pos-web)

## Context

Physical gift cards are pre-printed plastic cards carrying a QR code of the voucher code.
Acre Club (Plotholders) owns the data; Grid activates and spends them.

```
inactive  -- printed, in a box, worth NOTHING
   |  ACTIVATED at a till when the customer pays for the card   <- this task
   v
active    -- loaded and spendable
   |  SPENT at a till, applied to an order                       <- already works
   v
redeemed  -- single-use, no change given
```

Task 003 (already built and merged in this working tree) added the backend:

- `POST /vouchers/gift-cards/activate` `{ code }` → activates one card, 409 with a
  readable message if it can't.
- `VoucherValidateRead` now carries `kind`, `source`, `status` and `is_gift_card`.
- `Product` now carries `is_gift_card: boolean`.

Read `docs/tasks/003-physical-gift-cards-backend.md` before starting.

## Scope — three changes

### 1. Scanner must not burn a gift card

`pos-web/src/components/Scanner.tsx` has a standalone Redeem button that consumes a voucher
outright, with **no order attached**. For a free-scoop voucher that is correct. For a S$50
gift card it destroys S$50 and applies nothing to a sale.

- When a scan resolves to a voucher with `is_gift_card === true`, the result card must
  **not** offer Redeem. Replace it with a clear instruction: the card's value and
  *"Add items to the sale and apply this at checkout."*
- Keep showing the amount and the code so staff can read the balance to the customer.
- The member-voucher list further down the same component (`redeemMemberVoucher`) must
  likewise not offer one-tap Redeem on a gift card; same substitution.

### 2. Scanner must report *why* a card was rejected

In `resolveScan`'s `tryVoucher`, a 409 currently always renders
`toast.error('Voucher has already been redeemed')`.

With activation in play, a 409 now also means **"this card was never paid for"** — a
completely different situation for the person at the counter, and the difference decides
what they do next. Surface the server's actual message
(`err?.response?.data?.detail`) when present, falling back to the current wording only if
there is no message. Do the same in `VoucherSheet.tsx`, which has the identical handler.

### 3. Activation at the point of sale

When a sale includes one or more products with `is_gift_card === true`, those cards must be
activated for exactly the amount paid.

**Ordering — this matters.** Activation happens **after payment succeeds**, never before.
If it ran first, an abandoned or failed sale would leave a live, spendable, unpaid card
sitting in the rack. Paying first means the worst case is a paid-for card that still needs
activating, which staff can see and fix — not free money walking out.

In `pos-web/src/components/PaymentModal.tsx`:

- After payment completes (where the flow currently reaches `setStep('complete')`), if the
  cart contained gift card lines, go to a new **`activate`** step instead of straight to
  `complete`.
- The step shows: *"Activate N gift card(s)"*, a scan/manual-entry field identical in
  behaviour to the existing voucher code entry, and progress (*"Card 2 of 3"*).
- Each entry calls the activation endpoint with the scanned code. On success, advance.
  On failure, show the server's message and let them scan a different card — a card may be
  damaged, or they may have grabbed one from a voided batch.
- Required count = the **sum of quantities** across gift card lines, not the number of
  lines. Three S$50 cards on one line is three cards to scan.
- Cards must be activated at the line's actual price (`customPrice ?? product.price`)
  — but note the *amount is set by the card's own batch denomination*, not by the POS. So
  if the scanned card's returned amount does **not** match the line price, show a clear
  warning: *"This card is worth S$X but the customer paid S$Y."* Do not block on it; staff
  may have legitimately grabbed the wrong denomination and can decide. Just never let it
  pass silently.

**Escape hatch.** Because the customer has already paid, the step needs a way out for a
genuinely unactivatable card (damaged QR, wrong box). Provide a "Can't activate now" action
behind an explicit confirm that states plainly: *"The customer has paid for N card(s) that
will not work. Note the codes and activate them from the Acre Club admin panel."* Log it to
the console with the order id. Do not make this the easy path — it must take two taps and a
confirmation.

## Conventions

- Follow the existing pos-web patterns: `toast` from `react-hot-toast`, `tapFeedback()` from
  `@/utils/haptics` on button presses, the `silent: true` axios flag for probe calls that
  shouldn't flash the global error toast.
- Reuse the existing scanner-input markup/classes (`.scanner-form`, `.scanner-input`) so the
  activation field looks and behaves like the voucher field staff already know.
- Add the API call to `pos-web/src/api/client.ts` alongside `validateVoucher`/`redeemVoucher`.
- Result overlays in this app are `.voucher-result-sheet` (fixed overlay). If you add an
  overlay, follow that pattern — a previous bug had a result card render below the fold
  behind a live camera feed, so it looked like nothing happened.

## Verification — required before you report done

1. `npx tsc --noEmit` in `pos-web/` passes with no new errors.
2. `npm run build` in `pos-web/` succeeds.
3. `npx vitest run` — pos-web has vitest (see `renderFromTemplate.test.ts`). Add tests for
   the pure logic you can test without a camera:
   - required-card-count = sum of quantities across gift card lines (cover the
     quantity-3-on-one-line case explicitly)
   - a gift card validate response yields the "apply at checkout" affordance, not Redeem
   Paste the real test output in your summary.

## Do NOT

- This working tree has **uncommitted work in progress** on an unrelated print-templates
  feature, and it touches `PaymentModal.tsx` too — specifically the receipt and kitchen-chit
  printing paths. **Do not revert, reformat, refactor or clean up any of it.** Your changes
  to `PaymentModal.tsx` must be purely additive and must not touch the printing code.
- Do **not** run any git command that changes state (no checkout, stash, reset, commit).
- Do **not** implement balances or partial redemption. Single-use, no change given, is a
  deliberate business decision.
- Do **not** activate before payment, for the reason given above.
