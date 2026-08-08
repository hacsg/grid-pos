# Task 009 — Report CDC separately, and show what was redeemed

## Context

**CDC vouchers are issued by the government, not by us.** They never enter Grid as a code.
Staff key a **CDC amount** into the split-payment flow at checkout, and it lands on
`orders.cdc_amount` (`NUMERIC(10,2)`, migration `0013_add_cdc_amount_to_orders.sql`).
There is no voucher row and nothing is scanned.

Two consequences, both of which this task fixes:

1. **CDC is invisible in reporting.** `payment_display_split` in
   `backend/app/services/analytics.py:109` adds `cdc_amount` into the same bucket as
   `voucher_amount`, so the Dashboard's Payment Mix shows one indistinguishable slice.
2. **Two admin paths exist that cannot work.** Grid's campaign voucher issuance and the
   "Create CDC voucher" button both write rows the POS will never accept — `validate_voucher`
   looks every scanned code up in Plotholders ("Plotholders is source of truth"), so a
   Grid-issued code fails at the till. They are traps, not features.

## Part A — separate CDC in the payment mix

`backend/app/services/analytics.py`:

- Add `"CDC"` to `PAYMENT_BUCKETS`. Place it **after `"Voucher"`** so existing chart colour
  ordering stays stable for the buckets that already existed.
- In `payment_display_split`, stop folding CDC into Voucher:

  ```python
  voucher = Decimal(str(order.voucher_amount or 0))
  cdc = Decimal(str(order.cdc_amount or 0))
  buckets["Voucher"] += voucher
  buckets["CDC"] += cdc
  ```

  The residual calculation must subtract **both**, so the mix still sums to `order.total`.
  That invariant is the point of the function — do not break it.

- **Do not touch `backend/app/services/gto.py`.** It merges CDC into voucher too, but that
  is the landlord mall feed and its format is an external agreement. Changing it is a
  separate decision. Leave it exactly as it is and note it under "Notes for review".

`backend/tests/test_analytics.py` already covers `payment_display_split`. Extend it:

- a split order with both a voucher and a CDC amount puts each in its own bucket
- the buckets still sum to `order.total` (assert this explicitly)
- an order with CDC and no voucher shows zero in Voucher, not a merged figure

## Part B — a redemption breakdown for the Dashboard

Extend the existing analytics dashboard payload (do **not** add a new page) with a
`redemptions` object covering the selected range and outlet filter:

```jsonc
{
  "cdc":      { "orders": 12, "value": 60.00 },        // orders with cdc_amount > 0
  "vouchers": { "count": 30, "value": 210.00,          // rows in order_vouchers
                "by_type": [ { "type": "acre_group", "count": 28, "value": 200.00 },
                             { "type": "cdc",        "count": 2,  "value": 10.00 } ] }
}
```

- CDC comes from `orders.cdc_amount > 0` on paid orders in range.
- Vouchers come from `order_vouchers.amount_applied` joined to `vouchers.type`, scoped to
  orders in range. That table is the real redemption log: `apply_vouchers_to_order` writes a
  row for every voucher applied at a till.
- Respect whatever date-range and outlet filtering the dashboard endpoint already applies —
  reuse it, do not invent a second filtering path.

## Part C — admin UI

### 1. Dashboard (`admin/src/pages/Dashboard.tsx`)

- Payment Mix picks up the new CDC bucket automatically once the backend returns it;
  check the chart legend and colours still read clearly with six buckets.
- Add a **"Vouchers & CDC"** card in the existing grid, using the existing `Card` component
  and range picker. Show: CDC value and order count; voucher value and count; and the
  by-type split. Label CDC so it is unambiguous, e.g. *"Government CDC vouchers keyed in at
  checkout"* — someone reading this months from now should not think we issued them.
- **Do not** present a "redemption rate" for CDC. We do not issue CDC, so there is no
  denominator; showing a rate would be a fabricated number. Value and count only.

### 2. Vouchers page (`admin/src/pages/Vouchers.tsx`) — make it a read-only log

- **Remove** the "Issue Voucher" action (campaign issuance — the POS cannot accept those
  codes) and the "CDC" create action (writes rows nothing reads).
- **Keep** the list, its search, and the type/status/campaign filters. This page's value is
  showing what was actually redeemed.
- Update the subtitle: it currently says *"Campaign & CDC voucher management"*, which will
  be wrong. Something like *"Vouchers redeemed at the till"*.

### 3. Delete the Campaigns page

- Delete `admin/src/pages/Campaigns.tsx`, its route in `admin/src/App.tsx`, and its
  sidebar entry. Drop the `Megaphone` icon import if it becomes unused.
- The Vouchers page's campaign **filter** stays — campaign rows still exist as data and are
  worth filtering redeemed vouchers by. Only the campaign *editor* goes.
- Leave the backend `campaigns` router and model alone. Removing the admin page is the
  decision here; deleting the API and table is a bigger one for another day.

## Verification

1. `pytest` in `backend/` passes, including your new payment-split assertions. Paste the
   real output.
2. `npx tsc --noEmit` and `npm run build` in `admin/` pass.
3. State explicitly that `services/gto.py` is unchanged.
4. Confirm the payment mix still sums to the order total for: cash-only, card-only, a split
   with voucher + CDC, and a split with an unattributed residual.

## Do NOT

- Do not touch `backend/app/services/gto.py` — external feed format.
- Do not delete the campaigns API, model or table.
- Do not invent a CDC redemption rate.
- Do not change `pos-web/` at all. How CDC is keyed in at checkout is correct and stays.
