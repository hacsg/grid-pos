# Task 003 — Physical gift cards: Grid backend

## Context

Acre Club (the Plotholders service, repo `hacsg/plotholders`) now issues **physical gift
cards**: pre-printed plastic cards carrying a QR code of the voucher code, sold and spent
at outlets through Grid POS.

A physical card is a Plotholders voucher with `kind='amount_off'`, `source='gift'`, a
dollar `value`, and a `gift_batch_id`. Its lifecycle:

```
inactive  -- printed, in a box, worth NOTHING
   |  activated at a Grid till when the customer pays for it
   v
active    -- loaded and spendable
   |  spent at a Grid till
   v
redeemed  -- single-use, no change given
```

Plotholders is the source of truth for all of this. Grid never mints or values a card; it
only **activates** and **spends** them. There is no Shopify involvement anywhere in this
feature.

New Plotholders endpoint this task consumes (service auth, `X-Internal-Key`, already wired
up in `PlotholdersClient`):

```
POST /api/gifts/activate   { code, staff_id?, outlet? }  -> activated voucher
```

## The bug this task must fix (most important part)

`validate_voucher` in `backend/app/routers/vouchers.py:207` and `apply_vouchers_to_order`
in `backend/app/services/vouchers.py:181` both decide a voucher is spendable by checking
only `redeemed_at`. **Neither checks `status`.**

That means an `inactive` card — one still in the box, never paid for — validates as a
perfectly good S$50 voucher.

It is worse in `apply_vouchers_to_order`, which is deliberately staged:

- Phase 2 commits the discount to the local order,
- Phase 3 *then* calls Plotholders to redeem, and only **logs** on failure
  (`services/vouchers.py:261-267`).

So an unactivated card would have its discount applied and committed locally, the upstream
redeem would fail, and the error would be swallowed into a log line. That is free money.

**Both call sites must reject a voucher whose status is not spendable, before any local
write happens.**

## Files to change

1. `backend/app/schemas/voucher.py`
2. `backend/app/services/plotholders_client.py`
3. `backend/app/services/vouchers.py`
4. `backend/app/routers/vouchers.py`
5. `backend/app/models/product.py` + a new Alembic migration + product schemas (see §0)

## 0. Marking a product as a gift card

Selling a physical card starts as an ordinary sale: staff ring up a "Gift Card S$50" item.
The POS then has to know that this particular line item requires a card to be scanned and
activated. `Product` today has no SKU and no flags that can carry that.

Add an explicit boolean rather than matching on a category or product name — a renamed
category must not silently break activation and start selling dead cards.

- `backend/app/models/product.py`: add

  ```python
  # Selling this rings up a physical gift card: the POS must scan a card and
  # activate it for the product's price before the sale can complete.
  is_gift_card: Mapped[bool] = mapped_column(
      Boolean, nullable=False, default=False, server_default="false"
  )
  ```

- Add an **Alembic** migration under `backend/alembic/versions/` for the new column,
  following the existing migrations there (`down_revision` chained onto the current head —
  check `alembic heads` rather than guessing).

  **Use Alembic, not `backend/app/migrations/*.sql`.** That raw-SQL directory belongs to
  the unrelated in-flight print-templates work; ignore it.

- Expose `is_gift_card` on the product read schema (and the admin create/update schemas)
  in `backend/app/schemas/`, so the POS receives it with the catalogue and the admin can
  set it. Default `False` everywhere; this must be a no-op for every existing product.

## 1. `schemas/voucher.py`

Extend `VoucherValidateRead` so the POS can tell a gift card apart from a free-scoop
voucher (it currently cannot — it only carries `id/code/type/amount`):

```python
kind: str | None = None        # free_item | amount_off | percent_off
source: str | None = None      # gift | birthday | tier | ...
status: str | None = None      # active | inactive | redeemed | ...
is_gift_card: bool = False     # source == 'gift'
```

Add a request/response pair for activation:

```python
class GiftCardActivateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)

class GiftCardActivateRead(BaseModel):
    code: str
    amount: Money
    status: str
    expires_at: datetime | None = None
```

## 2. `services/plotholders_client.py`

Add one method, following the existing style of `redeem_voucher_by_code`:

```python
async def activate_gift_card(self, code: str, staff_id: str, outlet: str) -> dict[str, Any]:
    """Activate a physical gift card at the point of sale."""
```

→ `POST /api/gifts/activate` with `{code, staff_id, outlet}`.

Do not add retry logic. Do not swallow errors — let `PlotholdersAPIError` propagate so the
caller maps it.

## 3. `services/vouchers.py`

Add a module-level helper and use it in `apply_vouchers_to_order`:

```python
SPENDABLE_VOUCHER_STATUSES = {"active", "available", ""}

def _assert_spendable(external: dict, code: str) -> None:
    """Reject a voucher that Plotholders does not consider spendable.

    Physical gift cards are printed 'inactive' and are worth nothing until a till
    activates them at the point of sale. Checking redeemed_at alone would let an
    unactivated card off the print run be spent for its full face value.
    """
```

- Raise `409` with a staff-readable detail. For `status == 'inactive'` specifically, the
  message must be **"Gift card has not been activated — it must be paid for first"**, not
  a generic "invalid voucher". The counter staff needs to know what to do.
- Treat a missing/None status as spendable (older non-gift vouchers may not carry one) —
  hence `""` in the set above. Only a status that is *present and not spendable* rejects.
- Call it in **Phase 1** of `apply_vouchers_to_order`, right after the existing
  `redeemed` check, i.e. before any `db.add` / `flush` / `commit`.

## 4. `routers/vouchers.py`

**a.** In `validate_voucher`, call the same `_assert_spendable` helper after the existing
`redeemed` check, and populate the new `VoucherValidateRead` fields from the Plotholders
record (`kind`, `source`, `status`, `is_gift_card = source == 'gift'`).

**b.** Add the activation endpoint:

```python
@router.post("/gift-cards/activate", response_model=GiftCardActivateRead)
```

- Auth: `current_staff: Staff = Depends(get_current_staff)` — same as the other POS routes.
- Passes `staff_id=str(current_staff.id)` and the staff's outlet.
- Maps `PlotholdersAPIError` through the existing `_plotholders_http_exception` helper so a
  409 from Plotholders ("already activated", "not a physical gift card") reaches the POS
  as a 409 with its message intact. Staff must see *why* activation failed.

**Route ordering:** this router already has `@router.post("/redeem")` and other literal
paths; make sure the new literal path does not sit behind any `/{voucher_id}` style route.

## Verification — required before you report done

Grid's test suite is `pytest` under `backend/`. There is no `test_vouchers.py`; the relevant
existing coverage is in **`backend/tests/test_plotholders_routes.py`** and
**`backend/tests/test_plotholders_client.py`**. Add your tests there, following the mocking
approach those files already use (they stub the Plotholders HTTP layer — reuse that rather
than inventing a new fixture). Cover:

1. `validate_voucher` on an `inactive` gift card → **409**, and the message mentions
   activation.
2. `apply_vouchers_to_order` with an `inactive` card → **409**, and — assert this
   explicitly — **no `OrderVoucher` row is created and the order total is unchanged**.
   This is the free-money regression; prove it cannot happen.
3. `validate_voucher` on an `active` gift card → 200 with `is_gift_card=True` and the
   correct amount.
4. Activation endpoint success, and a 409 passed through from Plotholders.

Mock Plotholders with the existing pattern used by the current voucher tests (there is
already a fake/transport approach in this repo — follow it rather than inventing one).

Run `pytest` and paste the real output in your summary. Do not claim a test passes without
showing it.

## Do NOT

- This working tree has **uncommitted work in progress** on an unrelated print-templates
  feature (`backend/app/main.py`, `backend/app/models/__init__.py`, plus new
  `print_template*` files). **Do not revert, reformat, refactor or "clean up" any of it.**
  Make only additive changes for this task, and do not touch those files at all unless this
  spec names them — it does not.
- Do **not** run `git checkout`, `git stash`, `git reset`, or `git commit`. Leave version
  control entirely alone.
- Do **not** implement balances or partial redemption. Gift cards are single-use with no
  change given; that is a deliberate business decision.
- Do **not** add a local Grid-side gift card table. Plotholders owns this data.
