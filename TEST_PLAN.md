# KPay Payment Terminal — Test Plan

When the physical KPay terminal arrives, run these tests in order. Each test validates a specific integration point between the frontend, backend, daemon, and hardware.

## Prerequisites

- [ ] Physical KPayPOS terminal powered on and connected to LAN
- [ ] Terminal reachable from cashier PC (`ping <terminal-ip>`)
- [ ] Daemon running on cashier PC (check with `curl http://localhost:9000/health` or nssm status)
- [ ] Daemon logs show "Signed in successfully"
- [ ] Railway backend deployed and healthy (`curl https://your-railway-app.up.railway.app/health`)
- [ ] Frontend running (local dev `npm run dev` or deployed)
- [ ] Test order created in POS (small amount, e.g., $1.00)

## Test Categories

### Category 1: Connection & Authentication (5 min)

**Test 1.1: Terminal Network Reachability**
- From cashier PC: `curl http://<terminal-ip>:18080/v2/pos/heartbeat`
- Expected: HTTP 200 with `{"retCode":"000000"}`
- If fails: check LAN cable, terminal IP, firewall rules

**Test 1.2: Daemon Sign-In**
- Check daemon logs for: "KPay sign-in successful"
- Expected: Working keys cached, `platformPublicKey` and `appPrivateKey` logged
- If fails: check APP_ID, APP_SECRET, MANAGER_PASSWORD in `.env`

**Test 1.3: Daemon → Railway WebSocket**
- Check Railway logs for: "WebSocket connection established"
- Check daemon logs for: "Connected to Railway"
- Expected: Heartbeat pings every 30s
- If fails: check KPAY_RAILWAY_WS_URL, KPAY_DAEMON_TOKEN

**Test 1.4: Frontend → Backend Connection Check**
- Open POS UI, click "Card" button
- Frontend calls `GET /api/kpay/connection?outlet_id=<uuid>`
- Expected: "Terminal connected ✓" indicator appears
- If fails: check X-Outlet-Id header, backend router registration

---

### Category 2: Payment Success Flow (10 min)

**Test 2.1: End-to-End Card Payment (Happy Path)**
- Create order: `1x Ice Cream ($1.00)`
- Click "Card" → "Complete Order"
- Expected sequence:
  1. Frontend shows "Processing payment..." with spinner
  2. Terminal screen shows payment prompt (amount $1.00)
  3. Tap/insert test card on terminal
  4. Terminal displays "Approved"
  5. Frontend transitions to receipt screen
  6. Order status = "paid" in database
  7. `payment_method='card'`, `payment_reference` = KPay transaction ref
- If fails at step 2: check daemon `start_sale` command logs
- If fails at step 5: check backend polling loop, frontend polling interval

**Test 2.2: Payment Intent State Transitions**
- Monitor backend logs during payment:
  - `Creating payment intent ...` (status=pending)
  - `Creating payment intent ... status → processing` (after start_sale)
  - `Polling payment intent ...` (every 2s)
  - `Payment intent ... status → success` (after terminal confirms)
- Expected: All transitions logged in order
- If fails: check PaymentIntent table in database, status column

**Test 2.3: Order Payment Fields Updated**
- Query database: `SELECT payment_method, payment_reference FROM orders WHERE id='<order-id>'`
- Expected: `payment_method='card'`, `payment_reference='KPAY-...'`
- If fails: check `update_payment_intent_status()` in `app/services/payment_intents.py`

**Test 2.4: Receipt Consistency**
- Compare terminal receipt vs POS receipt:
  - Amount: must match exactly
  - Transaction ref: terminal shows `out_trade_no`, POS shows same in `payment_reference`
  - Timestamp: should be within 1s
- If fails: check amount formatting in daemon (`%012d` → cents)

---

### Category 3: Error Handling & Edge Cases (15 min)

**Test 3.1: Terminal Offline (Network Disconnected)**
- Disconnect terminal LAN cable
- Create order → click "Card" → "Complete Order"
- Expected:
  - Frontend shows error toast: "Terminal offline" or similar
  - Order status remains "unpaid"
  - No PaymentIntent created (or status=failed immediately)
- Reconnect terminal, retry payment → should succeed
- If fails: check `check_daemon_connection()` in `app/routers/ws_daemon.py`

**Test 3.2: User Cancels on Terminal**
- Create order → click "Card" → "Complete Order"
- When terminal prompts for card, press "Cancel" on terminal
- Expected:
  - Terminal shows "Transaction cancelled"
  - Frontend shows error: "Payment cancelled"
  - PaymentIntent status = "failed", error_message = "User cancelled"
  - Order remains "unpaid"
- If fails: check daemon `query` response handling for cancel status

**Test 3.3: Payment Timeout (No Card Inserted)**
- Create order → click "Card" → "Complete Order"
- Do NOT tap/insert card, wait 90s
- Expected:
  - Terminal shows timeout message
  - Frontend shows error: "Payment timed out"
  - PaymentIntent status = "timeout"
  - Order remains "unpaid"
- If fails: check backend polling loop timeout logic (90s cutoff)

**Test 3.4: Daemon Crashes Mid-Payment**
- Create order → click "Card" → "Complete Order"
- While terminal is processing, kill daemon (`nssm stop kpay-daemon`)
- Expected:
  - Backend polling loop detects WebSocket disconnect
  - After 90s, PaymentIntent status = "timeout"
  - Frontend shows error: "Terminal disconnected"
- Restart daemon, retry payment → should succeed
- If fails: check WebSocket reconnection logic in daemon

**Test 3.5: Railway Backend Restarts Mid-Payment**
- Create order → click "Card" → "Complete Order"
- While terminal is processing, restart Railway deployment
- Expected:
  - PaymentIntent remains in `processing` state in database
  - After Railway restarts, polling loop resumes
  - If terminal completed payment, intent transitions to `success`
  - If terminal timed out, intent transitions to `timeout`
- If fails: check that polling loop fetches all `status='processing'` intents on startup

**Test 3.6: Duplicate Payment (Same Order, Two Clicks)**
- Create order → click "Card" → "Complete Order"
- Wait 5s, click "Complete Order" again (same order)
- Expected:
  - First payment completes normally
  - Second attempt: frontend should NOT allow (button disabled after first click)
  - OR: backend rejects duplicate PaymentIntent for same order_id
- If fails: check PaymentModal.tsx for button disable logic, or add unique constraint `(order_id, status='success')` in backend

---

### Category 4: Key Management (5 min)

**Test 4.1: Working Key Expiry (Response 40004)**
- Create multiple orders (>20) or wait for key expiry (if terminal enforces it)
- Daemon should receive `retCode=40004` from KPay
- Expected:
  - Daemon logs: "Working key expired, re-signing in"
  - Daemon calls `POST /v2/pos/sign` again
  - New working keys cached
  - Payment retried with new keys → succeeds
- If fails: check `kpay/client.go` key refresh logic

**Test 4.2: Signature Mismatch (Crypto Bug)**
- Intentionally modify daemon `appPrivateKey` in `.env` (change one character)
- Restart daemon
- Create order → click "Card"
- Expected:
  - Daemon tries to sign request, signature fails
  - Terminal returns `retCode=40001` (invalid signature) or similar
  - Daemon logs: "Signature verification failed"
  - Frontend shows error: "Terminal authentication error"
- Restore correct key, retry → should succeed
- If fails: check `kpay/signer.go` SHA256withRSA logic

---

### Category 5: Concurrent Payments (5 min)

**Test 5.1: Two Orders Simultaneously (Different Terminals)**
- Open two POS sessions (different cashier PCs, different outlets)
- Create order A on PC-1, order B on PC-2
- Click "Card" on both at the same time
- Expected:
  - Each daemon handles its own terminal independently
  - Both payments complete successfully (or fail independently)
  - No cross-contamination (order A's payment doesn't affect order B)
- If fails: check outlet_id routing in backend, daemon connection isolation

**Test 5.2: Rapid Polling (Stress Test)**
- Create 5 orders in quick succession, click "Card" on all
- Expected:
  - Backend polling loop handles all 5 intents concurrently
  - Each terminal processes independently
  - No race conditions in database updates
- If fails: add database transaction isolation, check for `SELECT ... FOR UPDATE` patterns

---

### Category 6: Cancel & Refund (Not Yet Implemented)

**Note**: Cancel/refund operations are NOT yet wired to the frontend. These tests are for future development.

**Test 6.1: Cancel Before Card Tap**
- Create order → click "Card" → "Complete Order"
- Before tapping card, click "Cancel" button in POS
- Expected:
  - Backend sends `cancel` command to daemon
  - Daemon calls `POST /v2/pos/cancel` with RSA-encrypted manager password
  - Terminal cancels pending transaction
  - PaymentIntent status = "cancelled"
- If fails: implement `cancel` endpoint in `app/routers/kpay.py`, wire to daemon `cancel` command

**Test 6.2: Refund After Successful Payment**
- Complete a successful card payment
- In order history, click "Refund" button
- Expected:
  - Backend sends `refund` command to daemon
  - Daemon calls `POST /v2/pos/refund` with RSA-encrypted manager password
  - Terminal processes refund, prints refund receipt
  - PaymentIntent status = "refunded" (new status needed)
  - Order status = "refunded"
- If fails: implement `refund` endpoint, add "refunded" status to PaymentIntent enum

---

### Category 7: Performance & Logging (5 min)

**Test 7.1: Polling Overhead**
- Monitor Railway logs during 10 concurrent payments
- Expected:
  - Polling loop queries database once per cycle (not per intent)
  - WebSocket sends only to connected daemon (no broadcast)
  - CPU usage < 10% on Railway
- If fails: optimize `get_processing_intents()` query, batch WebSocket sends

**Test 7.2: Log Volume**
- After 1 hour of testing, check log storage (Railway logs, nssm logs)
- Expected:
  - INFO logs for state transitions only (not every poll)
  - DEBUG logs for every WS command (disabled in production)
  - Total log size < 50MB/hour
- If fails: adjust logging levels in daemon (`slog.LevelInfo`), backend (`logging.INFO`)

**Test 7.3: Database Growth**
- After 100 payments, check `payment_intents` table size
- Expected:
  - ~100 rows, ~100KB total
  - Indexes on `status`, `outlet_id`, `out_trade_no` working (check query performance)
- If fails: add `status` index, archive old intents (move to `payment_intents_archive` table)

---

## Post-Test Checklist

After all tests pass:

- [ ] Document any bugs found (create GitHub issues)
- [ ] Update `HANDOFF.md` with troubleshooting notes learned
- [ ] Deploy daemon to all 4 cashier PCs (repeat deployment checklist)
- [ ] Train staff on card payment flow (show terminal screen, POS receipt)
- [ ] Set up monitoring (Railway alerts for daemon disconnect, payment failures)
- [ ] Create runbook for common issues (see `HANDOFF.md` Troubleshooting section)

## Test Environment Variables

For staging tests (before production rollout):

```bash
# Daemon
KPAY_TERMINAL_BASE_URL=http://192.168.1.50:18080
KPAY_APP_ID=<staging-app-id>
KPAY_APP_SECRET=<staging-app-secret>
KPAY_MANAGER_PASSWORD=123456

# Backend
KPAY_DAEMON_TOKEN=<generate-with-openssl-rand-hex-32>

# Frontend
VITE_API_BASE_URL=https://staging-railway-app.up.railway.app
```

For production tests (after staging validation):

```bash
# Daemon
KPAY_TERMINAL_BASE_URL=http://192.168.1.50:18080  (or production terminal IP)
KPAY_APP_ID=<production-app-id>
KPAY_APP_SECRET=<production-app-secret>
KPAY_MANAGER_PASSWORD=<production-manager-password>

# Backend
KPAY_DAEMON_TOKEN=<production-token>

# Frontend
VITE_API_BASE_URL=https://production-railway-app.up.railway.app
```

## Success Criteria

- All Category 1-5 tests pass (65 test cases)
- Zero data loss (every successful payment reflected in database)
- Zero duplicate charges (same order cannot be charged twice)
- <5s response time from "Complete Order" click to "Processing..." screen
- <90s max timeout (user sees error, not infinite spinner)
- Logs show clear state transitions for debugging
