# KPay Daemon Windows Setup Guide

## What You Have
- `kpay-daemon.exe` - Windows executable (9.8MB)
- This setup guide

## Step 1: Create Daemon Folder

On your Windows PC, create a folder:
```
C:\KPayDaemon\
```

## Step 2: Copy Files

Copy `kpay-daemon.exe` to `C:\KPayDaemon\`

You can find it at:
```
/home/edmxnd/projects/grid-pos/services/kpay-daemon/kpay-daemon.exe
```

## Step 3: Create Configuration File

Create a file called `.env` in `C:\KPayDaemon\` with this content:

```env
# Railway WebSocket URL (where daemon connects to Grid POS backend)
KPAY_DAEMON_WS_URL=wss://grid-backend-production-5fd0.up.railway.app/ws/daemon

# Authentication token (MUST match Railway backend KPAY_DAEMON_TOKEN)
KPAY_DAEMON_TOKEN=***
# This outlet's UUID (get from Grid POS app - see below)
KPAY_OUTLET_ID=YOUR_OUTLET_UUID_HERE

# KPay terminal IP address on your local network
# (terminal must be on same LAN as this Windows PC)
KPAY_TERMINAL_BASE_URL=http://192.168.1.50:18080

# KPay API credentials (provided by KPay)
KPAY_APP_ID=your_app_id_here
KPAY_AP...n
# KPay manager password (for refunds/cancels)
KPAY_M...rd=123456

# Local test mode (set to true to skip Railway connection)
KPAY_LOCAL_TEST=false
```

## Step 4: Get Your Outlet ID

**Option A: From Grid POS Web App**
1. Open Grid POS in browser
2. Log in as staff
3. Open browser DevTools (F12) → Console
4. Type: `JSON.parse(localStorage.getItem('grid_pos_staff_session')).outlet.id`
5. Copy the UUID shown

**Option B: From Railway Dashboard**
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
- "Connection refused" → Railway backend is down or URL is wrong
- "Authentication failed" → KPAY_DAEMON_TOKEN doesn't match Railway
- "Cannot reach terminal" → KPAY_TERMINAL_BASE_URL is wrong or terminal is off

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
- Verify KPAY_DAEMON_TOKEN matches on both sides

**Cannot reach terminal:**
- Ping terminal IP: `ping 192.168.1.50`
- Test terminal API: `curl http://192.168.1.50:18080/health`
- Check Windows Firewall allows outbound connections to terminal IP:18080

**Service crashes:**
- Check `C:\KPayDaemon\daemon-error.log`
- Run `kpay-daemon.exe` manually to see real-time errors
- Verify Go runtime is not required (daemon is self-contained)

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
- KPAY_DAEMON_TOKEN should be changed if compromised
- KPay credentials are sensitive - don't share
- Daemon only accepts commands from Railway (authenticated)
