# KPay Payment Terminal Integration — Handoff Guide

## Overview

Grid POS now supports KPayPOS payment terminals via a WebSocket bridge architecture. This document provides setup instructions for when the physical KPay terminal arrives.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│ React Frontend  │──poll──▶│ Railway Backend  │──WS────▶│ Go Daemon (Win) │──HTTP──▶│ KPay Terminal   │
│ (pos-web)       │         │ (FastAPI)        │         │ ( cashier PC)   │         │ (LAN IP:18080)  │
└─────────────────┘         └──────────────────┘         └─────────────────┘         └─────────────────┘
     polls 2s                  tracks state               speaks KPay protocol        physical hardware
```

**Key insight**: The daemon connects OUTBOUND to Railway, bypassing firewall/PNA issues. No inbound ports needed on cashier PC.

## Components

### 1. Go Daemon (`services/kpay-daemon/`)

Single binary that speaks the KPay HTTP protocol on the local LAN, then proxies commands via WebSocket to Railway.

**Source files:**
- `main.go` — entrypoint, signal handling
- `config.go` — environment variable loading
- `kpay/client.go` — HTTP client for KPay terminal
- `kpay/crypto.go` — RSA key parsing, signature verification
- `kpay/signer.go` — SHA256withRSA signing for requests
- `daemon/handler.go` — WebSocket command dispatch
- `daemon/state.go` — working key caching, rate limiting
- `daemon/ws.go` — WebSocket reconnection logic

**Environment variables** (create `.env` in `services/kpay-daemon/`):

```bash
# KPay terminal on local network
KPAY_TERMINAL_BASE_URL=http://192.168.1.50:18080

# Staging credentials (from KPayPOS-POS Terminal Interface V2-20241018.xlsx)
# For production, change these to real credentials
KPAY_APP_ID=your_app_id
KPAY_APP_SECRET=your_app_secret
KPAY_MANAGER_PASSWORD=123456

# Railway WebSocket endpoint
KPAY_RAILWAY_WS_URL=wss://your-railway-app.up.railway.app/ws/daemon

# Shared token (must match KPAY_DAEMON_TOKEN in Railway backend)
KPAY_DAEMON_TOKEN=generate-a-long-random-token-here

# This outlet's UUID (from Grid POS backend /admin/outlets)
KPAY_OUTLET_ID=uuid-of-this-outlet

# Local test mode (skip WebSocket, use HTTP :9000 for testing)
# KPAY_LOCAL_TEST=true
```

**Build the Go binary** (on Windows, or cross-compile):

```bash
cd services/kpay-daemon
go build -o kpay-daemon.exe .
```

**Deploy as Windows service** (requires admin):

```bash
# Install nssm (https://nssm.cc/)
nssm install kpay-daemon "C:\path\to\kpay-daemon.exe"
nssm set kpay-daemon AppDirectory "C:\path\to\daemon-directory"
nssm set kpay-daemon AppEnvironmentExtra KPAY_OUTLET_ID=uuid-here
nssm start kpay-daemon
```

**Or run manually** (for debugging):

```bash
./kpay-daemon.exe
```

Logs go to stdout. Ctrl+C to stop gracefully.

### 2. Railway Backend (`backend/`)

FastAPI server with WebSocket endpoint for daemon, payment intent tracking, background polling.

**New files:**
- `app/models/payment_intent.py` — PaymentIntent SQLAlchemy model
- `app/routers/ws_daemon.py` — WebSocket server `/ws/daemon`
- `app/routers/kpay.py` — REST endpoints `/api/kpay/*`
- `app/services/payment_intents.py` — CRUD + polling loop
- `migrations/add_payment_intents.sql` — creates payment_intents table

**Railway environment variables** (add via Railway dashboard):

```bash
KPAY_DAEMON_TOKEN=same-token-as-daemon-env
```

That's it — all other vars (database URL, JWT secret) already exist.

**Automatic migration**: The `payment_intents` table is created on first Railway deploy via `migrations.py`. No manual SQL execution needed.

**WebSocket endpoint**: `wss://your-railway-app.up.railway.app/ws/daemon?token=TOKEN&outlet_id=UUID`

### 3. Frontend (`pos-web/`)

React app with card payment flow in PaymentModal.

**New files:**
- `src/api/kpayClient.ts` — REST client for KPay endpoints
- `src/api/client.ts` — added `request<T>()` helper (generic fetch wrapper)

**Modified files:**
- `src/components/PaymentModal.tsx` — card payment mode with 2s polling
- `src/index.css` — processing state styles

**No new env vars needed** — frontend uses existing `VITE_API_BASE_URL` (Railway backend URL).

## Payment Flow

1. **User clicks "Card" button** in PaymentModal
2. Frontend calls `POST /api/kpay/start` (order_id, amount)
3. Backend creates PaymentIntent (status=pending), sends `start_sale` WS command to daemon
4. Daemon calls KPay terminal `POST /v2/pos/sales` with signed request
5. Backend marks intent as `processing`, returns intent ID
6. Frontend polls `GET /api/kpay/status/{id}` every 2s
7. Backend polling loop (runs every 2s) sends `query` WS command to daemon
8. Daemon calls KPay terminal `GET /v2/pos/query` to check status
9. When terminal returns terminal state (success/failed/timeout), backend updates intent + order
10. Frontend sees `success`, marks order as paid, shows receipt
11. Frontend sees `failed`/`timeout`, shows error, offers retry

## Testing Checklist

### Pre-deployment (no hardware)

Use **local test mode** to verify the stack works end-to-end with mocked KPay responses.

**Daemon side:**

```bash
cd services/kpay-daemon
cp .env.example .env
# Edit .env:
#   KPAY_LOCAL_TEST=true
#   KPAY_RAILWAY_WS_URL=http://localhost:8765/ws/daemon  (or local Railway dev server)
#   KPAY_DAEMON_TOKEN=test-token
#   KPAY_OUTLET_ID=some-uuid-from-db

go run .
# Should start HTTP server on :9000 (not connect to Railway)
```

**Backend side (local dev):**

```bash
cd backend
cp .env.example .env
# Edit .env:
#   KPAY_DAEMON_TOKEN=test-token  (must match daemon)

python -m app.main
# Should start on http://localhost:8000
# Run migration: python -c "import asyncio; from app.migrations import run_sql_migrations; asyncio.run(run_sql_migrations())"
```

**Frontend side (local dev):**

```bash
cd pos-web
npm run dev
# Should start on http://localhost:5173
# Point browser to http://localhost:5173
```

**Test sequence:**

1. Open POS UI, create an order
2. Click "Card" button
3. Frontend calls `POST http://localhost:8000/api/kpay/start`
4. Check backend logs — should see "Creating payment intent"
5. Check backend logs — should see "Sending start_sale to daemon"
6. Check daemon logs — should see HTTP request to KPay terminal (but in local test mode, returns mock success)
7. Frontend polls `GET http://localhost:8000/api/kpay/status/{id}` every 2s
8. Backend polling loop sends `query` to daemon
9. Mock terminal returns `status=success` after 3s
10. Frontend shows receipt completion screen

### Post-deployment (with hardware)

Once physical KPay terminal arrives:

1. **Network setup**: Assign static IP to terminal (e.g., 192.168.1.50), verify it's reachable from cashier PC:
   ```bash
   ping 192.168.1.50
   curl http://192.168.1.50:18080/v2/pos/heartbeat
   ```

2. **Update daemon .env**:
   ```bash
   KPAY_TERMINAL_BASE_URL=http://192.168.1.50:18080
   KPAY_LOCAL_TEST=false  # or remove this line
   ```

3. **Restart daemon**:
   ```bash
   nssm restart kpay-daemon
   ```

4. **Test sign-in**: Check daemon logs for "Signed in successfully"

5. **Test real payment** (small amount):
   - Create order in POS
   - Click "Card"
   - Wait for terminal to process (should show countdown on terminal screen)
   - Insert/tap card
   - Verify payment completes
   - Check order marked as paid in POS
   - Check terminal receipt matches POS receipt

6. **Test failure modes**:
   - Disconnect terminal network → retry payment → should see "Terminal offline" error
   - Cancel on terminal → should see "Payment cancelled" in POS
   - Timeout (don't insert card) → should see "Payment timed out" in POS

## Troubleshooting

### Daemon won't start

**Check:**
- Go binary exists and is executable
- `.env` file present with all required vars
- `KPAY_TERMINAL_BASE_URL` is reachable from cashier PC (`curl` test above)
- `KPAY_RAILWAY_WS_URL` uses `wss://` (not `ws://`) for production

**Logs**: Check nssm logs or stdout if running manually.

### Daemon connects but sign-in fails

**Check:**
- `KPAY_APP_ID` and `KPAY_APP_SECRET` match staging/production credentials
- `KPAY_MANAGER_PASSWORD` is correct RSA-encrypted password (default `123456`)
- Terminal is in correct mode (WiFi/POS, not 2-in-1)

**Logs**: Look for "Sign-in failed" with error code. Common codes:
- `40001` — Invalid appId/appSecret
- `40004` — Working key expired (daemon should auto-refresh)
- `40010` — Manager password wrong

### Backend can't send commands to daemon

**Check:**
- `KPAY_DAEMON_TOKEN` matches in both daemon and Railway env
- `KPAY_OUTLET_ID` is a valid UUID from the outlets table
- Railway WebSocket URL is correct (not `.up.railway.app` typo)

**Logs**: Check Railway logs for "Daemon connected" / "Daemon disconnected"

### Frontend gets 503 "Terminal not connected"

**Cause**: Daemon not connected to Railway.

**Fix**:
1. Check daemon logs (should see "Connected to Railway")
2. Check Railway logs (should see "WebSocket connection established")
3. Verify token and outlet ID match
4. Restart daemon if needed

### Payment stuck in "processing" state

**Cause**: Backend polling loop not running, or daemon not responding to `query` commands.

**Check**:
- Railway logs: should see "Polling payment intent {id}" every 2s
- Daemon logs: should see "Query request received" from backend
- Terminal: check if transaction actually completed on terminal screen

**Fix**:
- Restart Railway deployment if polling loop crashed
- Check daemon is still connected (should auto-reconnect on disconnect)

## Security Notes

- **KPAY_DAEMON_TOKEN**: Treat like a password. Generate with `openssl rand -hex 32`. Rotate if compromised.
- **KPAY_APP_SECRET**: Never log this. Daemon logs mask it as `***`.
- **Manager Password**: Used for cancel/refund operations. RSA-encrypted in transit. Do not hardcode in source.
- **Terminal IP**: If terminal is on untrusted network, use VPN or firewall rules to restrict access to :18080.

## Deployment Checklist

For each cashier PC (4 outlets):

- [ ] Assign static IP to KPay terminal
- [ ] Build Go binary (`go build -o kpay-daemon.exe .`)
- [ ] Copy binary + `.env` to cashier PC
- [ ] Install nssm, create Windows service
- [ ] Start service (`nssm start kpay-daemon`)
- [ ] Verify daemon connects to Railway (check Railway logs)
- [ ] Test sign-in (check daemon logs)
- [ ] Test real payment (small amount)
- [ ] Update Grid POS outlet ID in `.env` if needed (from `/admin/outlets`)

## Future Considerations

- **Cancel/Refund**: Not yet wired to frontend. Add buttons in order history that call daemon `cancel` / `refund` commands.
- **Multiple terminals per outlet**: Current design assumes 1 terminal per outlet. If multiple, add terminal ID routing in daemon.
- **Offline mode**: If Railway is down, queue payments locally in daemon, sync when connection restored.
- **Receipt printing**: Terminal prints its own receipt. Consider sending digital receipt via email/SMS from backend after payment success.

## Contact

For KPay API questions, refer to:
- `KPayPOS-POS Terminal Interface V2-20241018.xlsx` (password-protected, password provided)
- KPay technical support (contact via sales team)

For Grid POS backend issues, check Railway logs or ask the development team.
