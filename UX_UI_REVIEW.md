# Grid POS — UX/UI Review (`pos-web`)

**Reviewer:** Senior UX/UI + Frontend
**Scope:** `pos-web` — staff cashier UI (`/`), customer display (`/display`), voucher mode (`/vouchers`), payment/KPay flow.
**Date:** 2026-06-27
**Codebase reviewed:** `pos-web/index.html`, `pos-web/tailwind.config.js`, `pos-web/src/index.css` (3257 lines), `App.tsx`, `components/*`, `display/CustomerDisplay.tsx`.

---

## Executive summary

- **The "premium" font is a lie that never loads.** `index.css:17` and `:1968` declare `font-family: Inter, …` and `tailwind.config.js:21` lists Inter — but **Inter is never imported** (no `<link>` in `index.html`, no `@font-face`, no `@fontsource` dependency in `package.json`). Every screen is currently rendering in **Segoe UI / system sans** on the Windows till. This is the single highest-leverage fix in the whole codebase: load a real typeface and the entire product looks intentional overnight. **(P0)**
- **Weight inflation reads as "loud", not "confident".** The UI leans on `font-weight: 800` everywhere (≈30 occurrences) and even `850`/`900` (`index.css:930`, `:944`, `:1583`). Aesop/Blue Bottle minimalism is built on *restraint*: 400–500 body, 600 emphasis, 700 max for the rare hero number. Right now everything shouts equally, so nothing has hierarchy. **(P1)**
- **The customer display (`/display`) is already the best-looking surface** — dark, large, generous spacing. It just needs (a) a real display font, (b) `font-variant-numeric: tabular-nums` on prices, and (c) the inconsistent `…`/`×` glyphs cleaned up. Treat it as the north star and pull the staff UI up to it. **(P1)**
- **Emoji + checkmark glyphs are leaking into the UI as text.** `'Terminal connected ✓'` (`PaymentModal.tsx:529`) renders an emoji checkmark inline with text — exactly the "AI slop" tell to remove. Use the existing `lucide-react` `Check`/`CheckCircle2` icons that are already imported. **(P1)**
- **Color palette is good and disciplined** (warm `#f8f5f0` paper, single forest-green `#2f6f3e` accent, semantic success/warning/error). Keep it. The problems are **type, weight, and spacing rhythm**, not hue. A few contrast/focus gaps (warning text on pale amber, `:focus-visible` clipped by overflow) are quick AA fixes. **(P2)**

---

## Quick wins — top 5 (biggest uplift / least effort)

1. **Actually load the font (Inter Variable or pair with Fraunces) via `@fontsource`.** ~10 lines. Instantly upgrades 100% of screens. → *Issue 1.*
2. **Add `tabular-nums` + tight tracking to all money + headings.** One CSS block on `:root` and price classes. Prices stop "wobbling" and headings tighten. → *Issue 3.*
3. **Global weight diet: 800→700 for emphasis, 700→600 for buttons/labels, kill 850/900.** Find-and-replace in `index.css`. → *Issue 2.*
4. **Replace the inline `✓` emoji + standardize `…`/`×`/`–` glyphs.** `PaymentModal.tsx:529`, `:525`, `:1071`. → *Issue 8.*
5. **Bump card/modal radius `8px → 14px`, soften border to `#ececec`, unify shadows to one token set.** The `8px`-everything look is the most "templated" tell. → *Issues 4 + 5.*

---

## Typography — exact spec

### Issue 1 — Inter is declared but never loaded (P0)

**Files:** `pos-web/index.html:1-16`, `pos-web/src/index.css:17`, `:1968`, `pos-web/tailwind.config.js:20-22`, `pos-web/package.json` (deps).

**Current state:** Three places name `Inter`, nothing fetches it. Verified: `grep` for `fontsource|googleapis|font-face` returns only the two `font-family` declarations — no loader anywhere. On the production Windows till (`deploy/windows`) this resolves to **Segoe UI**. The careful `font-family` list is decorative.

**Recommended fix — self-hosted, offline-safe (this is a POS that can lose internet):**

```bash
npm i @fontsource-variable/inter
```

`pos-web/src/main.tsx` (top of file):

```ts
import '@fontsource-variable/inter/wght.css';
```

Self-hosting matters: this app is offline-capable (`public/sw.js`, offline banner `App.tsx:537`). A Google Fonts `<link>` would break typography the moment the till drops connection. Use `@fontsource*`, **not** `fonts.googleapis.com`.

Make the stack honest in `index.css:17` and `:1968`:

```css
font-family: 'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
```

### Recommended pairing (premium, confident, minimal)

Two routes — pick one. Both free + self-hostable via `@fontsource`.

**Route A — "Operator" (recommended for the staff till): one family, two roles.**
- **Everything: `Inter Variable`**, but unlock its character (tracking + features, Issue 3). Inter looks generic at defaults; it looks Stripe/Linear-premium when dialed in. Lowest risk, best legibility for dense transactional UI on a cheap panel.

**Route B — "Editorial" (Aesop / Blue Bottle tier): serif display + grotesque body.**
- **Headings / brand / hero numbers: `Fraunces`** (`@fontsource-variable/fraunces`) — optical-size variable serif, weight 500–600. A warm serif against warm paper (`#f8f5f0`) *is* that aesthetic.
- **Body / UI / prices: `Inter Variable`** weight 400–500.
- Apply Fraunces only to: `.brand-block h1`/`.login-brand h1`, `.display-thanks-title`, `.display-total-row`, `.voucher-title`, modal `<h2>` headers. Keep all dense data (cart lines, tables, buttons) in Inter.

> **Recommendation:** **Route A** for the staff till (speed, legibility, zero serif-rendering risk at small sizes). Use **Route B only on `/display`**, where type is large and the brand moment matters — a Fraunces "Thank you" at 56px on black is genuinely beautiful. Alternative grotesque if you want something less ubiquitous than Inter: **`Geist`** (`@fontsource-variable/geist`) or **`Hanken Grotesk`** — both read more "designed".

### Type scale to standardize (replace ad-hoc px)

Current sizes are scattered (13/14/15/16/17/18/20/22/26/28/30/32px with no system). Add to `:root` in `index.css` and migrate:

```css
:root {
  --font-sans: 'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
  /* Type scale (~1.2 minor third) */
  --text-xs: 12px;   /* meta, pills, captions */
  --text-sm: 13px;   /* secondary labels */
  --text-base: 15px; /* body / UI default */
  --text-md: 17px;   /* primary buttons, search input */
  --text-lg: 20px;   /* section headers, cart total */
  --text-xl: 26px;   /* modal hero amount */
  --text-2xl: 34px;  /* manual paynow amount */

  /* Weights — the diet (Issue 2) */
  --fw-regular: 400;
  --fw-medium: 500;
  --fw-semibold: 600;
  --fw-bold: 700;

  /* Tracking */
  --track-tight: -0.02em;  /* large headings / numbers */
  --track-label: 0.04em;   /* small uppercase labels only */
}
```

### Weights & sizes by element (target state)

| Element | Current | Target weight | Target size |
|---|---|---|---|
| Brand `h1` (`Grid POS`) | implicit 700, 20px | `600`, tracking `-0.01em` | 20px |
| Section headers (`Current sale`, modal `h2`) | bold | `600` | `--text-lg` |
| Buttons (`.primary/.secondary-button`) | **800** (`:779`) | `600` | `--text-md` |
| Product category line | 13px muted | `400` | `--text-sm` |
| Product name (`.product-copy h2`) | 16px, bold | `500` | 16px |
| Price (`.product-meta strong`) | 16px bold | `600` + `tabular-nums` | 16px |
| Cart total (`.total-row`) | 20px | `700` + `tabular-nums` | `--text-lg` |
| Stock pill / chips | **800** (`:336`) | `600` | `--text-xs` |
| Modifier group title | **850** (`:930`) | `600` | 17px |
| Display hero numbers | 600 (good) | keep `600` + `tabular-nums` | unchanged |

---

### Issue 2 — Weight inflation (everything is 800) (P1)

**Files:** `index.css` — `font-weight: 800` at lines `143, 285, 336, 379, 489, 544, 607, 779, 1107, 1179, 1218, 1229, 1263, 1513, 1534, 1676, 2398, 2639, 2695, 2768…`; `850`/`900` at `:930, :944, :1033, :1583`.

**Current state:** Near-uniform `800`. Combined with the (currently) system font, the UI reads heavy and undifferentiated — the opposite of the calm, high-confidence minimalism requested.

**Fix — global pass:**
- `font-weight: 800` → `600` for **labels, pills, chips, buttons, nav tabs**.
- `font-weight: 800` → `700` only for **the single most important number in a view** (cart total, payment hero, change due).
- Delete every `850`/`900` → `600`.
- Body copy / secondary lines → `400`–`500`.

Hierarchy should come from **size + color + space**, not weight. Example `.primary-button` (`index.css:779`):

```css
.primary-button, .secondary-button, .icon-text-button, .icon-button {
  font-weight: var(--fw-semibold); /* 600, was 800 */
}
```

---

### Issue 3 — Numbers don't align; no OpenType polish (P1)

**Files:** every `formatCurrency(...)` render — `.product-meta strong` (`index.css:321`), `.cart-totals`/`.total-row` (`:565`, `:570`), `.display-total-row` (`:2143`), `.amount-field input` (`:1537`), `PaymentModal` summary rows.

**Current state:** Proportional figures → prices visually "wobble" as digits change (a `1` is narrower than a `0`). On a money screen this looks cheap and is the easiest premium tell to miss. Note: `.voucher-time` (`:2654`) and `.voucher-recent-card-meta` (`:3169`) **already** use `tabular-nums` — so the pattern exists, it just isn't on the actual prices.

**Fix:** Add a utility and apply to every monetary value + the body default:

```css
body { font-feature-settings: 'cv11'; } /* Inter: single-storey 1, cleaner */

.product-meta strong,
.cart-totals strong, .total-row strong,
.payment-summary strong, .amount-field input,
.display-total-row, .display-item-price, .display-thanks-total,
.display-processing-total, .display-paynow-amount,
.terminal-panel strong, .manual-paynow-panel > strong {
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--track-tight);
}
```

Large headings also want negative tracking (the display already does this at `:2149`, `:2211`). Apply `letter-spacing: -0.01em` to `.brand-block h1`, modal hero `h2`, `.voucher-title`.

---

## Visual design

### Issue 4 — `8px`-radius-everything is the templated tell (P1)

**Files:** `index.css` — `border-radius: 8px` appears ~40×; the file mixes `8/10/12/14/16/999px` with no rule (vouchers use `12–16px` at `:2717`/`:2918`, loyalty cards `12px` at `:728`, parked-trigger `999px` at `:604`).

**Fix:** Define a radius scale and apply by element, larger for containers:

```css
:root { --r-sm: 10px; --r-md: 14px; --r-pill: 999px; }
```
- `.product-card` (`:261`), `.modifier-sheet`/`.payment-modal`/`.loyalty-sheet` (`:851`), `.login-panel` (`:1095`) → `--r-md`.
- `.primary/.secondary-button`, inputs, `.search-field` → `--r-sm`.
- Pills/chips/tabs → pick **one** of `--r-pill` or `--r-sm` and use it consistently (mixing `8px` pills with `999px` parked-trigger looks accidental).

### Issue 5 — Borders + shadows are flat and bespoke (P2)

**Files:** `--grid-border: #e5e5e5` (`:13`); shadows hand-rolled per component (`:271`, `:854`, `:1098`, `:1206`, `:1835`).

**Fix:**
```css
:root {
  --border: #ececec;            /* was #e5e5e5 — a hair too dark on warm paper */
  --shadow-sm: 0 1px 2px rgba(20,20,20,0.04);
  --shadow-md: 0 4px 16px rgba(20,20,20,0.06);
  --shadow-lg: 0 16px 48px rgba(20,20,20,0.12);
}
```
- `.product-card:hover` (`:269`): drop the `translateY(-1px)` lift and heavy `0 10px 24px` shadow → use `--shadow-md` + subtle border tint. Hover-lift does nothing on a touch till and just adds motion noise.

### Issue 6 — Modifier sheet has a decorative gradient + glow (gimmick) (P2)

**File:** `index.css:894-895` — `.modifier-body` uses a `linear-gradient(... rgba(248,245,240,0.8))` faux fade; selected option adds a colored bar pseudo-element (`:1009`), `translateY(-1px)` hover (`:999`), and `0 8px 20px rgba(47,111,62,0.16)` green glow (`:1006`).

**Current state:** The most "designed-by-AI" component — gradient fade + accent glow + lift transforms stacked.

**Fix:** Remove the gradient (`:894-896`). Keep selection legible with just `border: 2px solid var(--grid-primary)` + `background:#eef7f0` + the `Check` icon (already present). Drop the green box-shadow glow; a 2px border is enough signal on a tap target.

### Issue 7 — Off-palette amber build banner (P2)

**File:** `index.css:2320` (`.build-banner` `background:#f59e0b`); rendered in `App.tsx` (build info).

**Current state:** `#f59e0b` is off-palette (system warning is `#b7791f`). Dev chrome bleeding onto a customer-facing till.

**Fix:** Gate behind a dev flag, or restyle to `background: var(--grid-warning); color:#fff`. The KPay `.terminal-status` pills (`:1506`, three states) are well done — leave them (but remove the inline emoji, Issue 8).

### Issue 8 — Emoji / inconsistent glyphs rendered as UI text (P1)

**Files:**
- `PaymentModal.tsx:529` — `'Terminal connected ✓'` bakes an emoji checkmark into a string.
- Ellipsis inconsistent: `CustomerDisplay.tsx:276` uses `…` (correct); `PaymentModal.tsx:1071`/`:1114`/`:534` use `...` (three dots).
- Multiply sign inconsistent: `CustomerDisplay.tsx:230` uses `×` (correct); receipt/`buildReceiptText` (`PaymentModal.tsx:157`, `:1137`) use `x`.
- Separator inconsistent: `ProductGrid.tsx:200` (`{outletName} - {staffName}`) and `PaymentModal.tsx:525`/`:641` use hyphen `-` where an en-dash `–` reads better.

**Fix:**
- `PaymentModal.tsx:529`: drop the `✓`. `.terminal-status.connected` already conveys success via color; or render a lucide `<Check size={14}/>` in JSX rather than a glyph in the string.
- Standardize the ellipsis to `…` everywhere.
- Use `×` (U+00D7) in all **customer-visible** quantity displays; keep ASCII `x` only in the raw thermal-printer text (`buildReceiptText` — printers are safer with ASCII).
- Use en-dash `–` for `Outlet – Staff` style separators.

---

## UX / functionality

### Issue 9 — Loading state only exists for the product grid (P1)

**Files:** `ProductGrid.tsx:250-253` (good skeleton). Missing elsewhere.

**Current state:**
- `LoginScreen.tsx:136` — staff roster shows bare text `"Loading staff…"`; outlet `<select>` is empty during `outletsQuery.isLoading`.
- `PaymentModal` — `terminalConnected === null` shows only `"Checking terminal..."` text.
- Cart, vouchers, loyalty — no skeletons.

**Fix:** Reuse the existing `.skeleton` keyframe (`index.css:354`). Add skeleton tiles to `.staff-grid` and a shimmer row for terminal-checking. Consistency of loading affordance is a big perceived-quality lever.

### Issue 10 — Empty states are one-liners, not designed (P2)

**Files:** `.empty-state`/`.cart-empty` (`index.css:370`), `ProductGrid.tsx:255-260` (`No products found`), `CartSidebar.tsx:158` (`No items`), `.voucher-recent-empty` (`:3114`).

**Current state:** `"No items"` / `"No products found"` — functional but flat. The cart empty state is the screen a cashier stares at all day between sales.

**Fix:** Give the cart empty state a calm treatment: one muted lucide icon (`ScanLine`/`ShoppingCart`), a primary line "Scan or tap a product to start", a secondary hint, generous vertical centering. One icon, two short lines — no emoji, no color.

### Issue 11 — Error handling is inconsistent across surfaces (P1)

**Files:** `PaymentModal.tsx:890` (`.payment-error` red block — good), `ProductGrid.tsx:359` (`.form-error`), toasts (`App.tsx:835`), `ErrorBoundary` fallback (`App.tsx:589-597` with **inline styles** + hardcoded `#666`).

**Current state:** Four different error patterns (red block, inline form text, black toast, inline-styled modal). The `ErrorBoundary` fallback bypasses the design system.

**Fix:** Standardize on two patterns — (1) inline `.field-error` for validation, (2) toast for transient/system errors. Move the `ErrorBoundary` inline styles into an `.error-fallback` class. `submitPin` (`LoginScreen.tsx:83`) currently only *shakes* on failure — add a toast distinguishing network error vs wrong PIN so staff know what happened.

### Issue 12 — Focus rings inconsistent and partly clipped (P1, a11y)

**Files:** global `:focus-visible { outline: 2px solid var(--grid-primary) }` (`index.css:61-64`); inputs override with a `box-shadow` ring (`:1123-1130`).

**Current state:** Two focus treatments. The outline at `offset:2px` gets clipped by `overflow:hidden` containers (`.product-card` `:259`, `.quantity-stepper` `:526`, modals). External-keyboard / accessibility audits will flag this.

**Fix:** Unify on a `box-shadow` ring (not clipped by overflow):
```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--grid-background), 0 0 0 5px var(--grid-primary);
}
```
Remove the bespoke input ring or align it to this token.

### Issue 13 — Contrast: warning text fails AA on pale amber (P2, a11y)

**Files:** stock pill "low" — `color: var(--grid-warning) #b7791f` on `#fff4d7` (`index.css:344-347`) ≈ **3.0:1**, fails AA for ~12px text. `--grid-muted #667085` on white ≈ 4.6:1 (borderline at 12px non-bold, e.g. `.staff-tile-role` `:1235`).

**Fix:** Darken the low-stock pill text (e.g. `#8a5a00`) so it clears 4.5:1 on `#fff4d7`; verify all three stock-pill combos (`in`/`low`/`out`) at the 12px size. Nudge captions to ≥4.5:1.

### Issue 14 — Tap targets: mostly good, three gaps (P1, POS-critical)

**Current state (good):** `button { min-height: 44px }` global (`:50`), pin-pad 64px (`:1346`), checkout/primary 48px. Genuinely well done for a till.

**Gaps:**
- `.cart-line-name` edit button sets `min-height:auto` (`index.css:476`; `CartSidebar.tsx:165`) — the pencil-edit hit area is tiny. Enlarge to ≥40px tap zone (padding or pseudo-element).
- `.voucher-result-close` 36px (`:2930`) and `.staff-session-info` (40px, `App.tsx:725`) are under the 44px touch minimum.
- Verify `.category-tabs button` rows don't drop below 44px at the tablet breakpoint.

**Fix:** Audit every interactive element for ≥44×44px (ideally 48px for a fast till). Enlarge hit area via padding/pseudo-element without changing visual size.

### Issue 15 — Scan feedback is great in vouchers, absent in main POS (P1, POS-UX)

**Files:** Voucher mode has an excellent scan flow — `qrFlash` keyframe (`index.css:2763`), corner frame, haptics. The main product search (`ProductGrid.tsx:210-218`) is a plain debounced text search (`App.tsx:207-210`, 300ms) — **no barcode affordance, no scanned-confirmation, no auto-add on exact match.**

**Current state:** On a real POS staff scan barcodes. The 300ms debounce also *delays* keyboard-wedge scanner input (scanners type fast then send Enter).

**Fix:**
- Add an `onKeyDown` Enter handler on the search input: on exact SKU/barcode match, immediately add to cart + `tapFeedback()` (haptics util exists, `utils/haptics.ts`) + brief green flash on the cart.
- Bypass the 300ms debounce when input arrives as a fast burst ending in Enter (scanner) vs typed.
- Mirror the voucher `qrFlash` success animation on `.cart-sidebar` when an item is added, so the cashier gets unmistakable confirmation without looking away.

### Issue 16 — Tablet responsiveness: solid, with rough edges (P2)

**Current state (good):** Thoughtful breakpoints at 1100/900/520px; mobile cart becomes a bottom sheet (`index.css:1825-1856`); product grid reflows to 2-col. Real work.

**Gaps:**
- At ≤900px the cart bottom-sheet `transform: translateY(calc(100% - 80px))` (`:1836`) leaves only an 80px peek — on a busy order the cashier can't see items without expanding. Consider keeping side-by-side down to ~820px before collapsing.
- `.payment-modes` collapse to 1 column under 520px (`:1922`) — four stacked full-width buttons push the summary below the fold. Keep a 2×2 grid instead of 1×4.
- Under 900px the brand subtitle (`:1803`) **and** the Sign-out text label (`.icon-text-button.subtle` `:1804`) are hidden, leaving an unlabeled icon button — see Issue 17.

### Issue 17 — ARIA / semantics gaps (P2, a11y)

- `ProductGrid.tsx:203` sign-out button has **no `aria-label`**; when its text is hidden on tablet (`:1804`) it's an unlabeled icon.
- `PaymentModal.tsx:859` uses `role="tablist"`/`role="tab"` with no `tabpanel`/`aria-controls`. The split toggle (`:948`) correctly uses `radiogroup`/`radio` — make the payment-mode selector consistent (it's a single-select control → `radiogroup` fits better than tabs).
- `.product-card` is a `<button>` containing an `<h2>` (`ProductGrid.tsx:281`) — heading-inside-button is awkward; use a styled `<span>` and add `aria-label="Add {name}, {price}"` to the button.
- Modals set `role="dialog" aria-modal="true"` ✅ but most have **no focus trap and no `Escape`-to-close** (settings closes on backdrop click `App.tsx:747`; payment/modifier modals don't). Add `Escape` handlers + initial focus.

### Issue 18 — Placeholder `G` brand mark (P2)

**Files:** hardcoded letter `G` in `.brand-mark` (`ProductGrid.tsx:197`, `LoginScreen.tsx:111`, css `:133`); display falls back to `'HAC'` text (`CustomerDisplay.tsx:194`).

**Current state:** A green square with `G` is the literal definition of a placeholder logo. The display *already* supports a real `brandLogoUrl` (`CustomerDisplay.tsx:190`); the staff UI doesn't.

**Fix:** Pass `session.outlet.logo_url` into the staff `.brand-mark` too, falling back to a refined wordmark in the new display font rather than a boxed letter. Boxed-letter avatars are fine for *staff* avatars; weak as the *product's* brand.

---

## Per-issue priority index

| # | Issue | Priority | Effort |
|---|---|---|---|
| 1 | Inter never loaded → system font | **P0** | XS |
| 2 | Weight inflation (800 everywhere) | P1 | S |
| 3 | No tabular-nums / OpenType polish on money | P1 | XS |
| 8 | Emoji `✓` + inconsistent `…`/`×`/`-` glyphs | P1 | XS |
| 4 | `8px` radius everywhere | P1 | S |
| 9 | Loading states only on product grid | P1 | M |
| 11 | Inconsistent error patterns + inline styles | P1 | M |
| 12 | Focus rings clipped/inconsistent | P1 | S |
| 14 | Three sub-44px tap targets | P1 | S |
| 15 | No scan feedback in main POS | P1 | M |
| 5 | Flat borders / bespoke shadows | P2 | S |
| 6 | Modifier sheet decorative gradient/glow | P2 | XS |
| 7 | Off-palette amber build banner | P2 | XS |
| 10 | Thin empty states | P2 | S |
| 13 | Warning text contrast < AA | P2 | XS |
| 16 | Tablet bottom-sheet peek / payment stacking | P2 | M |
| 17 | ARIA gaps (labels, focus trap, esc) | P2 | M |
| 18 | Placeholder `G` brand mark | P2 | S |

---

## Suggested implementation order (for the coding agent)

1. **Foundations (do first — unblocks the whole look):** Issue 1 (load font) → Issue 3 (tabular-nums) → Issue 2 (weight diet) → add the `:root` type/radius/shadow tokens from Issues 1/4/5.
2. **Polish pass (small CSS/string edits):** Issues 8, 4, 6, 7, 10, 13.
3. **UX correctness:** Issues 12, 14, 15, 9, 11.
4. **Responsive + a11y:** Issues 16, 17, 18.

> **Do not** touch the color hues, the customer-display layout, the breakpoint architecture, or the KPay payment state machine — those are good. This is a **typography + weight + spacing-rhythm refinement, not a redesign.**
