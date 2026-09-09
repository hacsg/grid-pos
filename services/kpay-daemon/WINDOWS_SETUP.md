# KPay Daemon Windows Setup Guide

## What You Have
- `kpay-daemon.exe` - Windows executable
- This setup guide

## Windows Compatibility

The daemon supports **Windows 7 / Server 2008 R2 and newer** (64-bit).

To stay compatible with Windows 7 POS machines, the `.exe` is built with the
**Go 1.20 toolchain** — the last Go release that supports Windows 7/8. Go 1.21
and later drop Windows 7 support: their runtime calls `ProcessPrng` from
`bcryptprimitives.dll`, which does not exist on Windows 7, so binaries built
with newer Go crash immediately at startup with:

```
Exception 0xc0000005 0x8 0x0 0x0
internal/runtime/syscall/windows.asmstdcall(...)
```

If you rebuild the daemon yourself, you **must** use Go 1.20.x:

```bash
cd services/kpay-daemon
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o kpay-daemon.exe .
```

(`go.mod` is pinned to `go 1.20`. Do not bump it past 1.20 unless every POS
machine has been upgraded to Windows 10+.)

## Step 1: Create Daemon Folder

On your Windows PC, create a folder:
```
C:\KPayDaemon\
```

## Step 2: Copy Files

Copy `kpay-daemon.exe` to `C:\KPayDaemon\`

You can find it in this repo at:
```
services/kpay-daemon/kpay-daemon.exe
```

## Step 3: Create Configuration File

Create a file called `.env` in `C:\KPayDaemon\` with this content:

```env
# This outlet's UUID — set to THIS till's outlet (see the table in Step 4 below)
OUTLET_ID=YOUR_OUTLET_UUID_HERE

# Backend WebSocket URL (where the daemon connects to the Grid POS backend)
RAILWAY_WS_URL=wss://grid-backend-production-5fd0.up.railway.app/ws/daemon

# Shared auth token (MUST match KPAY_DAEMON_TOKEN on the Railway backend)
DAEMON_AUTH_TOKEN=YOUR_SHARED_TOKEN_HERE

# KPay terminal on your LAN — bare IP maps to http://<ip>:18080 automatically
KPAT_TERMINAL_IP=192.168.1.50

# KPay API credentials (provided by KPay)
KPAT_APP_ID=your_app_id_here
KPAT_APP_SECRET=your_app_secret_here

# KPay manager password (for void/refund)
KPAT_MANAGER_PASSWORD=123456

# Local test mode (set to 1 to skip the WS connection and run :9000)
# KPAY_LOCAL_TEST=1
```

## Step 4: Get Your Outlet ID

**Option A: Copy from the list below (easiest)**

Set `OUTLET_ID` to the UUID for THIS till's outlet:

| Outlet | OUTLET_ID (UUID) |
|---|---|
| HAC Bedok | `2b029d9a-cc3c-4c29-8993-c1688a309a29` |
| HAC SSC | `c3e5a387-4a1a-4ee9-9e80-3a335d816636` |
| HAC Sunset Way | `9d936497-511c-46a3-b262-806c37485a40` |
| HAC Tampines | `b29fc9ca-ade6-4869-bb36-0db319092343` |

List current as of 2026-09. If an outlet is added or renamed, get the latest
from the public endpoint — open `https://grid-backend-production-5fd0.up.railway.app/api/outlets`
in a browser (returns all outlets with `id` and `name`) — or use Option B/C below.

**Option B: From Grid POS Web App**
1. Open Grid POS in browser
2. Log in as staff
3. Open browser DevTools (F12) → Console
4. Type: `JSON.parse(localStorage.getItem('grid_pos_staff_session')).outlet.id`
5. Copy the UUID shown

**Option C: From Railway Dashboard**
1. Go to Railway → grid-pos-api → grid-backend → Variables
2. Click "Open Database" or use Railway's PostgreSQL GUI
3. Run: `SELECT id, name FROM outlets;`
4. Copy the UUID for your outlet

## Step 5: Set KPay Terminal IP

Find your KPay terminal's IP address:
- Check terminal settings/display
- Or scan your network: `arp -a` in Windows CMD
- Look for the device that responds to `http://IP:18080`

Update `KPAY_TERMINAL_BASE_URL` in `.env` with the correct IP.

## KPay certification (get your production APP_ID + secret)

Before you get live KPay credentials, KPay requires you to run their standard
transaction test cases (sale, query, cancel/void, refund) against a physical
terminal and submit the results. The daemon has a **local test mode** built for
exactly this — it talks straight to the terminal on your LAN and skips Railway.

You need: the new PC and the physical KPay terminal on the same network, the
terminal's IP, and the **sandbox/test** APP_ID + secret KPay issued you.

1. Put `kpay-daemon.exe` in `C:\KPayDaemon\` with a `.env` like:

   ```env
   KPAY_LOCAL_TEST=1
   KPAT_TERMINAL_IP=192.168.1.50        # your terminal's real LAN IP
   KPAT_APP_ID=<kpay test app id>
   KPAT_APP_SECRET=<kpay test secret>
   KPAT_MANAGER_PASSWORD=<kpay manager password>   # for void/refund
   ```

   In local-test mode `OUTLET_ID`, `RAILWAY_WS_URL` and `DAEMON_AUTH_TOKEN` are
   **not** required — you can certify before any outlet wiring exists.

2. Run `kpay-daemon.exe`. It listens on `http://localhost:9000` and does the
   KPay `/v2/pos/sign` key handshake automatically on the first signed call.

3. Double-click **`kpay-cert-test.bat`** (next to the exe). It's a menu-driven
   harness that fires each certification transaction, prints the terminal's real
   response, and saves every request/response as timestamped JSON under
   `kpay-cert-evidence\` — that folder is what you submit to KPay.

   Transaction types it drives (amounts entered in dollars, sent as cents;
   currency SGD/702; `payment_type` 1=card, 13=PayNow, 14=Alipay, 15=WeChat,
   3/16=QR): **Sale → Query → Cancel/Void → Refund**. For a refund, take the
   `ref_no` and `transaction_no` from the sale's Query result (the harness
   remembers the last ones for you).

The raw local endpoints, if you'd rather script them yourself, are
`POST /kpay/sales`, `/kpay/query`, `/kpay/cancel`, `/kpay/refund` on `:9000`.

Once KPay issues your **production** APP_ID/secret, drop them into each outlet
till's `.env` (with `KPAY_LOCAL_TEST` removed and the Railway vars set) per the
steps below.

## Step 6: Test the Daemon

Open Command Prompt or PowerShell in `C:\KPayDaemon\`:

```cmd
kpay-daemon.exe
```

You should see logs like:
```
INFO Connecting to Railway WebSocket...
INFO Connected to wss://grid-backend-production-5fd0.up.railway.app/ws/daemon
INFO Daemon ready, waiting for commands...
```

**If you see errors:**
- "missing required env: ..." → a variable name in `.env` is wrong/blank (names are case-sensitive: OUTLET_ID, RAILWAY_WS_URL, DAEMON_AUTH_TOKEN, KPAT_TERMINAL_IP, KPAT_APP_ID, KPAT_APP_SECRET, KPAT_MANAGER_PASSWORD)
- "Connection refused" → Railway backend is down or RAILWAY_WS_URL is wrong
- "Authentication failed" → DAEMON_AUTH_TOKEN doesn't match the backend KPAY_DAEMON_TOKEN
- "Cannot reach terminal" → KPAT_TERMINAL_IP is wrong or the terminal is off

Press `Ctrl+C` to stop.

## Step 7: Install as Windows Service (Production)

Use NSSM (Non-Sucking Service Manager) to run daemon as a background service:

1. Download NSSM: https://nssm.cc/download
2. Extract `nssm.exe` to `C:\KPayDaemon\`
3. Open CMD as Administrator:
```cmd
cd C:\KPayDaemon
nssm install KPayDaemon C:\KPayDaemon\kpay-daemon.exe
nssm set KPayDaemon AppDirectory C:\KPayDaemon
nssm set KPayDaemon AppStdout C:\KPayDaemon\daemon.log
nssm set KPayDaemon AppStderr C:\KPayDaemon\daemon-error.log
nssm start KPayDaemon
```

**Manage the service:**
```cmd
nssm status KPayDaemon
nssm restart KPayDaemon
nssm stop KPayDaemon
nssm remove KPayDaemon confirm
```

**View logs:**
```cmd
type C:\KPayDaemon\daemon.log
```

## Step 8: Verify Connection

1. Start the daemon
2. Open Grid POS in browser
3. Go to payment screen
4. Click "Card" button
5. Should show "Terminal connected" (not "Terminal offline")

## Troubleshooting

**Daemon won't start:**
- Check `.env` file exists in same folder as `kpay-daemon.exe`
- Verify all required values are filled in (no "YOUR_..." placeholders)

**"Terminal offline" in POS:**
- Daemon logs should show "Connected to Railway"
- Check Railway logs for WebSocket connection messages
- Verify the daemon's DAEMON_AUTH_TOKEN matches the backend KPAY_DAEMON_TOKEN
- Confirm the daemon's OUTLET_ID matches the outlet you're logged into on the POS

**Cannot reach terminal:**
- Ping terminal IP: `ping 192.168.1.50`
- Test terminal API: `curl http://192.168.1.50:18080/health`
- Check Windows Firewall allows outbound connections to terminal IP:18080

**Service crashes:**
- Check `C:\KPayDaemon\daemon-error.log`
- Run `kpay-daemon.exe` manually to see real-time errors
- Verify Go runtime is not required (daemon is self-contained)

**`Exception 0xc0000005` immediately on launch (crash in `windows.asmstdcall`):**
- This means the `.exe` was built with Go 1.21+ and is running on Windows 7/8.
- Newer Go binaries call a Windows API (`ProcessPrng`) that does not exist on
  Windows 7, causing an instant access-violation crash before any config loads.
- Fix: use the Windows 7-compatible build (Go 1.20) — see
  [Windows Compatibility](#windows-compatibility) above — or upgrade the POS
  machine to Windows 10+.

## What Happens Next

Once daemon is running:
1. POS sends payment commands to Railway
2. Railway forwards to daemon via WebSocket
3. Daemon talks to KPay terminal on local network
4. Terminal processes card/PayNow payment
5. Result flows back to POS

**You still need the physical KPay terminal to test actual payments.**

## Security Notes

- Keep `.env` file secure (contains tokens and credentials)
- DAEMON_AUTH_TOKEN should be changed if compromised (and updated on the backend too)
- KPay credentials are sensitive - don't share
- Daemon only accepts commands from Railway (authenticated)
