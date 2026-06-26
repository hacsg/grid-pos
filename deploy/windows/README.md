# Grid POS — "POS mode" startup (Windows 7+)

Launches the POS in a clean, full-screen kiosk layout at login:

- **Primary monitor** → staff POS (`/`)
- **Secondary monitor** → customer display (`/display`)

Both open as chromeless Chrome "app" windows (no address bar or tabs), each on
its own monitor and full-screen. The second monitor is detected automatically;
with only one monitor, just the staff POS opens.

## Files

| File | Purpose |
|------|---------|
| `start-pos-mode.ps1` | The launcher. Edit the CONFIG block at the top. |
| `start-pos-mode.bat` | Double-clickable wrapper that runs the `.ps1`. |

## 1. Configure

Open `start-pos-mode.ps1` and edit the **CONFIG** block:

```powershell
$PosUrl     = 'https://your-pos-host'   # where the POS web app is served, no trailing slash
$ChromePath = $null                     # auto-detect, or set the full path to chrome.exe
$UseKiosk   = $false                    # $false = full-screen app (Alt+F4 exits)
                                        # $true  = locked --kiosk (Ctrl+Alt+Del to exit)
```

> The customer-display wallpaper/processing fixes already shipped in the app —
> this script just makes sure each screen opens full-screen on the right monitor.

## 2. Test it

Double-click `start-pos-mode.bat`. You should get the POS full-screen on the
main screen and the customer display full-screen on the second screen.

- Close a window: **Alt+F4** (or **Ctrl+Alt+Del → Task Manager** in `--kiosk`).
- If the screens are swapped, set the customer-facing monitor as **secondary**
  in Windows *Control Panel → Display → Screen Resolution* (the staff POS always
  takes the Windows **primary** monitor).

## 3. Run automatically at login

**Option A — Startup folder (simplest):**

1. Press `Win+R`, type `shell:startup`, press Enter.
2. Right-drag `start-pos-mode.bat` into that folder → **Create shortcuts here**.

Runs when the logged-in user signs in. Pair with Windows **auto-login** so the
till boots straight into POS mode.

**Option B — Task Scheduler (more robust):**

1. Task Scheduler → *Create Task*.
2. General: *Run only when user is logged on*.
3. Triggers: *At log on* (optionally a 10s delay so the desktop/network settle).
4. Actions: *Start a program* → `start-pos-mode.bat`.

## Notes / troubleshooting

- **"Restore pages?" bar after a power cut** — the script clears Chrome's
  unclean-exit flag on each launch, so it shouldn't appear. If it ever does,
  closing/reopening clears it.
- **Customer display sticks or shows wallpaper at the edges** — make sure you're
  running an app build that includes the display fixes (commit
  `fix(display): unstick processing screen…`).
- **Chrome on Windows 7** — the last supported build is Chrome 109; it runs this
  fine. Newer Chrome won't install on Win7.
- **KPay payment daemon is separate** — it runs as its own Windows service
  (see `../../HANDOFF.md`), not from this script.
- **Re-running** is safe — it just opens fresh windows; close the old ones first
  to avoid duplicates.
