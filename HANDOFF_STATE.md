# Grid POS — Project State & Pending Items Handoff

> Handoff for the next agent taking over Grid POS + the two connected systems
> (Plotholders loyalty API, landlord GTO feed). Written 2026-07-07. Everything
> below is committed and deployed unless marked otherwise. **Repos are clean;
> 240 backend tests pass; pos-web builds clean; all services healthy.**
>
> Context: single outlet — **Hundred Acre Creamery, #B1-K10** — going live on a
> Windows 7 Taobao all-in-one POS PC with a built-in POS58 (58mm) printer, a
> client-facing keyboard-wedge 2D scanner, and a **KPay** card terminal in
> **WiFi mode**. Two external parties are gating go-live (KPay production creds,
> mall SFTP creds).

## Systems & where they live

| System | Repo / path | Deploy |
|---|---|---|
| Grid backend (FastAPI) | `~/projects/grid-pos/backend` | Railway `grid-pos-api` → `grid-backend` |
| Grid POS web (React) | `~/projects/grid-pos/pos-web` | Railway `grid-pos-admin` → `grid-pos-web` |
| KPay daemon (Go 1.20, Win7) | `~/projects/grid-pos/services/kpay-daemon` | runs ON the POS PC (not Railway) |
| Plotholders / Acre Club (TS) | `~/plotholders` | Railway `acre-club` → `plotholders-api` (Dockerfile) |
| Landlord GTO feed | in grid backend (`services/gto.py`) | grid-backend + a Railway cron (not yet created) |

**Deploy = push to `main`; Railway auto-deploys.** Verify: backend
`python3 -m pytest tests -q`; pos-web `npx tsc --noEmit && npm run build`.
Live health: grid-backend `/health` 200, pos-web `/` 200, plotholders
`/health` 200; gated endpoints (`/api/gto/close-day`, plotholders
`/api/customers`) return 401 without auth — all confirmed 2026-07-07.

Railway CLI: `railway link --project <p> --environment production --service <s>`
then `railway variables --set K=V`, `railway deployment list --json`.
Postgres for local prod queries: use the **Postgres service's DATABASE_PUBLIC_URL**
(the internal URL won't resolve off-Railway).

---

## PENDING ITEMS (priority order)

### P1 — KPay production credentials (blocks card go-live)
**Status:** blocked on KPay. The whole card/PayNow flow is built and works on
staging for the *failure* paths; it has never approved a transaction because the
staging terminal declines every card (KPay confirmed this is expected for
staging), and the production terminal rejects our **staging** APP ID
`202606191354001` with `开发者应用信息不存在`.

**What's needed:** KPay must either (a) issue **test cards / a test wallet** that
approve on staging, or (b) provision the **production terminal** (production APP
ID + secret). A reply drafted for the WeCom group asks exactly this — see the
chit history; the user was sending it.

**The KPay acceptance matrix** (`(SG) KPay Terminal Payment Testing Case
Matrix.xlsx` on the user's OneDrive Desktop) must be run and returned to unlock
production creds. A readiness working copy —
`HAC_KPay_Matrix_Readiness_WORKING_COPY.xlsx` (Desktop) — colour-codes all 26
cases. Summary:
- **~9 runnable now on staging** (declines, timeouts, cancels, sign-out/in,
  consistency, retry).
- **3 blocked on an approving terminal:** Case 1 (card success), 5 (card
  reversal), 10 (scan-to-pay success). Also Case 14 (scan-to-pay refund).
- **Case 15 (terminal auto-print):** owner AGREED to use the KPOS terminal's own
  auto-print for the compliant receipt → just enable it on the terminal and
  photograph the result. **Case 16 (custom receipt with ~30 EMV fields) is
  therefore N/A** — do NOT try to reproduce KPay EMV fields on our receipt.
- **Cases 18–23 (Kiosk Mode Action API): N/A** — we're WiFi mode, staffed.
- **28–29 (tips): N/A** — HAC doesn't tip.

**When results arrive:** the user will send pass/fail + timestamp + KPay ref per
case; write them into the official xlsx (openpyxl can't *read* the original — its
stylesheet is malformed — but you can unzip it and read `xl/worksheets/*.xml` +
`sharedStrings.xml`, or build a fresh results sheet).

**Do NOT fabricate test results, timestamps, or ref numbers** — that's the
evidence KPay is buying; only the user can capture it live on the real terminal.

### P2 — Landlord GTO feed activation (blocks mall reporting)
**Status:** fully built + deployed, **dormant**. A sample test file
`H07111164_20260706.txt` (Desktop) was sent to the mall for format validation.
Awaiting: mall confirmation + **SFTP Password + Server IP**.

Mall details received: Unit **#B1-K10**, Shop "Hundred Acre Creamery", Option
**B2**, **Machine ID 07111164**. Open questions asked of the mall: (1) does
"Option B2" = this Hourly GTO format? (2) confirm HAC is **not GST-registered**.

**To activate once creds arrive** (set on `grid-backend`):
```
GTO_MACHINE_ID=07111164
GTO_SFTP_HOST=<Server IP>   GTO_SFTP_PORT=22 (confirm)
GTO_SFTP_USERNAME=<from mall>  GTO_SFTP_PASSWORD=<from mall>
GTO_SFTP_REMOTE_DIR=<from mall, or '.'>
GTO_GST_REGISTERED=false   (flip to true ONLY if mall says HAC is GST-registered)
GTO_CRON_SECRET=<generate: openssl rand -hex 32>
```
Then create a Railway **cron service** that `POST`s
`/api/gto/close-day` daily **~00:30 SGT (16:30 UTC)** with header
`X-Cron-Secret: <secret>` — same pattern as the gusta-sales pipeline-cron
(alpine + wget). That generates the previous SGT day's file and flushes any
unsent backlog. Endpoints for ops: `GET /api/gto/files` (status),
`/api/gto/files/{date}/preview`, `POST /api/gto/regenerate?sales_date=` (staff
auth). Test the SFTP first with `POST /api/gto/regenerate` for a past date and
watch `GET /api/gto/files` for `uploaded:true`.

**GTO design notes** (see `services/gto.py`): GTO = order total after discount;
GST=0 / flag=N (HAC not registered); cash→Cash, card+PayNow→**Others** (KPay
doesn't return card scheme), CDC/Acre vouchers→**Voucher** (via split legs);
payment buckets always sum to GTO; SGT hour bucketing; 0-sales day still emits a
file; batch_id sequential + **stable per date** on regenerate.

### P3 — Update the KPay daemon on the POS PC (blocks kitchen chit there)
**Status:** the newest `kpay-daemon.exe` (with the `/print-raw` endpoint the
kitchen chit needs) is staged in `C:\Users\guaaa\grid-pos-daemon-pospc\` and
served over LAN, but **may not yet be running on the POS PC**. The user must
re-download `kpay-daemon.exe` and restart it (reboot, or close + rerun
`start-pos-mode.bat`). Until then, kitchen-chit printing on the POS PC falls
back and fails. A local HTTP file server was run from that folder on
`http://192.168.0.163:8078` (the dev PC's LAN IP) — restart it with
`python.exe -m http.server 8078 --bind 0.0.0.0` from that folder if needed.

**POS PC operational facts (Win7, hard-won):**
- WebUSB can't see the built-in POS58 → receipt/chit/drawer all print via the
  **daemon's local print service** (`127.0.0.1:9123`, `/print` `/print-raw`
  `/drawer`) through the Windows driver. Confirmed working for receipt + drawer.
- The daemon is NOT a Windows service — elevation is broken on this Taobao image
  (`setup-pos-pc.bat` couldn't install the nssm service). It's launched at login
  by **`start-pos-mode.bat`** (in `shell:startup`), which also opens the POS +
  `/display` Chrome windows. Don't double-run the exe (fights over the port).
- The daemon reads `env.txt` (Windows-hidden-extension friendly) OR `.env`.
- Chrome "unsupported OS" warning is cosmetic; HKCU policy + a launcher flag try
  to suppress it but the build may still show it — not blocking.
- Remote access: `rustdesk-installer.exe` staged (portable mode works
  unelevated) for when the machine moves to the outlet.
- Terminal IPs are DHCP: staging was `192.168.0.71`, production `192.168.0.220`
  (a subnet scan finds them on port 18080). Daemon `.env` `KPAT_TERMINAL_IP`
  must match whichever terminal is in use; restart daemon after changing.

### P4 — Nice-to-have / deferred (not blocking go-live)
- **Cash / manual-PayNow refunds** in the Transactions page are a TODO (drawer +
  status only, no terminal reversal) — see the `TODO` in `TransactionsPage.tsx`.
- **Manual-PayNow auto-verify** (OCBC Velocity eAlert email → auto-confirm): the
  user decided AGAINST building this for launch (terminal PayNow is default;
  manual is the offline fallback, reconciled via daily Velocity export). Revisit
  only if the manual fallback gets real use.
- **Loyalty tier reward content** is a business decision the owner is still
  making (free product on milestones, gift-a-scoop referral at platinum). The
  engine + recurring-tier voucher issuance already exist in Plotholders; nothing
  to build until the owner picks reward-per-tier, then configure campaigns.
- **GTO card-scheme split:** if the mall rejects card→"Others" and demands
  Visa/MC/Amex/NETS columns, that data isn't available from KPay today — chase
  KPay before attempting.

---

## Recently completed (so you don't redo it)
- **Transactions page** (`TransactionsPage.tsx`): order lookup, Today/Yesterday/
  Last-7-days filters + date range + order-# search, reprint kitchen chit,
  reprint receipt, and **void/refund visible to all staff but requiring a
  manager PIN** (backend `_authorize_reversal` in `routers/kpay.py`: manager
  session OR a valid manager-role PIN at the outlet; a cashier's own PIN can't
  authorize; 5 tests). Receipt/chit builders were extracted to
  `utils/receipt.ts` (shared by checkout + reprint); `OrderItemRead` gained
  `product_name` (migration 158f4dd2).
- **Kitchen chit**: big/bold prep ticket, auto-prints on completion (toggle
  `localStorage grid_pos_auto_chit='0'`) + a button; via daemon `/print-raw`.
- **Loyalty rework**: moments = 1 visit/order (not spend); recorded on *payment*;
  checkout scan tags `order.customer_id` + shows the member's active Plotholders
  vouchers; tiers recalibrated to visit counts. Plotholders side deployed.
- **Security**: Plotholders customer/voucher/moment endpoints were public and
  leaking `pin_hash` — now gated (`requireServiceAuth`: `X-Internal-Key` for
  grid via `PLOT_HOLDERS_INTERNAL_KEY`, or admin cookie) and `pin_hash`
  stripped. Plotholders deploy fixed via a **Dockerfile** (Nixpacks was
  rebuilding `dist/` at boot and OOM-failing).
- **Cash tender pad**, **dynamic manual-PayNow QR** (UEN 202347737D, ref
  POS-MNL-QR, on POS + `/display`), **branded 58mm receipt** (brand/company from
  outlet fields), **cancel-stuck-payment** button, **KPay daemon WS dial
  timeout** fix.

## Prior handoff docs in-repo (still relevant background)
`HANDOFF_TRANSACTIONS_PAGE.md` (now built), `HANDOFF_DRAWER_PRINTING.md` (done),
`TEST_PLAN.md` (KPay hardware test plan), `HANDOFF*.md` (P0–P2 payment history).
