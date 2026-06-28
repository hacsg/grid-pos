<#
  Grid POS - "POS mode" startup launcher (Windows 7+, PowerShell 2.0+)

  Opens two clean, full-screen Chrome windows:
    * Primary monitor   -> staff POS        (https://<POS_URL>/)
    * Secondary monitor -> customer display (https://<POS_URL>/display)

  Each window runs in chromeless "app" mode (no address bar / tabs) with its
  own profile, positioned on the correct monitor and started full-screen. The
  second monitor is detected automatically; if only one monitor is found, only
  the staff POS is opened.

  Progress and errors are written to:  %LOCALAPPDATA%\GridPos\pos-mode.log

  Edit the CONFIG block below, then run via start-pos-mode.bat. See README.md
  for how to launch it automatically at login.
#>

# =================== CONFIG ===================
# Base URL where the POS web app is served (no trailing slash).
$PosUrl = 'https://grid-pos-web-production.up.railway.app'

# Path to chrome.exe. Leave as $null to auto-detect common install locations.
$ChromePath = $null

# Set $true for Chrome's locked --kiosk mode. NOTE: --kiosk ignores window
# placement, so it cannot reliably put a window on the *second* monitor. Use
# kiosk only on a single-monitor till. For dual-monitor, keep $false (the
# default full-screen app mode, which Alt+F4 can close).
$UseKiosk = $false

# Swap which monitor gets which screen, without changing Windows display
# settings. $false: POS on primary, display on secondary (normal).
$SwapMonitors = $false

# Seconds to wait for the POS host to become reachable before launching, so the
# till doesn't boot into Chrome's "no internet" page before the network is up.
# Set to 0 to skip the wait.
$NetworkWaitSeconds = 60
# ============================================

$ProfileRoot = Join-Path $env:LOCALAPPDATA 'GridPos'
$LogFile = Join-Path $ProfileRoot 'pos-mode.log'

function Write-Log {
    param([string]$Message)
    $line = ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
    try { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue } catch { }
}

function Show-Error {
    param([string]$Message)
    Write-Log "ERROR: $Message"
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        [System.Windows.Forms.MessageBox]::Show($Message, 'Grid POS - POS mode') | Out-Null
    } catch { }
}

function Find-Chrome {
    if ($ChromePath -and (Test-Path $ChromePath)) { return $ChromePath }
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    try {
        $reg = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction Stop
        if ($reg.'(default)' -and (Test-Path $reg.'(default)')) { return $reg.'(default)' }
    } catch { }
    return $null
}

# Test whether host:port accepts a TCP connection (PowerShell 2.0 safe; avoids
# Invoke-WebRequest, which doesn't exist before PS 3.0).
function Test-HostUp {
    param([string]$HostName, [int]$Port, [int]$TimeoutMs)
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($ok -and $client.Connected) { $client.EndConnect($iar); return $true }
        return $false
    } catch {
        return $false
    } finally {
        if ($client) { $client.Close() }
    }
}

function Wait-ForHost {
    param([string]$Url, [int]$WaitSeconds)
    if ($WaitSeconds -le 0) { return }
    try { $uri = [System.Uri]$Url } catch { Write-Log "Bad POS URL '$Url'; skipping network wait."; return }
    $port = $uri.Port; if ($port -le 0) { $port = if ($uri.Scheme -eq 'https') { 443 } else { 80 } }
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while (-not (Test-HostUp -HostName $uri.Host -Port $port -TimeoutMs 3000)) {
        if ((Get-Date) -gt $deadline) {
            Write-Log "Network wait timed out after ${WaitSeconds}s; launching anyway."
            return
        }
        Write-Log "Waiting for $($uri.Host):$port ..."
        Start-Sleep -Seconds 2
    }
    Write-Log "Host $($uri.Host):$port reachable."
}

# Clear Chrome's "exited_cleanly" flag so an unclean shutdown (e.g. power loss)
# doesn't show the "Restore pages?" bar over the kiosk on next boot. Must write
# UTF-8 *without* a BOM - a BOM makes Chrome treat Preferences as corrupt and
# reset the profile.
function Clear-CrashFlag {
    param([string]$ProfileDir)
    $prefs = Join-Path $ProfileDir 'Default\Preferences'
    if (-not (Test-Path $prefs)) { return }
    try {
        $json = [System.IO.File]::ReadAllText($prefs)
        $json = $json -replace '"exit_type":"[^"]*"', '"exit_type":"Normal"'
        $json = $json -replace '"exited_cleanly":false', '"exited_cleanly":true'
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($prefs, $json, $utf8NoBom)
    } catch {
        Write-Log "Could not clear crash flag in $prefs : $_"
    }
}

function Start-PosWindow {
    param(
        [string]$Chrome, [string]$Url, [string]$ProfileDir,
        [int]$X, [int]$Y, [int]$W, [int]$H, [bool]$Kiosk
    )
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    Clear-CrashFlag $ProfileDir

    $chromeArgs = @(
        "--user-data-dir=$ProfileDir",
        "--app=$Url",
        "--window-position=$X,$Y",
        "--window-size=$W,$H",
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        '--disable-infobars',
        '--noerrdialogs',
        '--disable-features=TranslateUI,Translate,InfiniteSessionRestore',
        '--disable-pinch',
        '--overscroll-history-navigation=0',
        '--check-for-update-interval=31536000',
        '--disable-component-update'
    )
    if ($Kiosk) { $chromeArgs += '--kiosk' } else { $chromeArgs += '--start-fullscreen' }

    Write-Log "Launching $Url at ${X},${Y} ${W}x${H} (kiosk=$Kiosk)"
    # -PassThru so the caller can wait for this window's instance to come up
    # before launching the next window into the SAME instance (see Wait-ForWindow).
    return (Start-Process -FilePath $Chrome -ArgumentList $chromeArgs -PassThru)
}

# Wait until a freshly-launched Chrome window has actually opened. This matters
# because the POS and the customer display talk only over a same-origin, SAME-
# INSTANCE BroadcastChannel. The 2nd window (display) is launched with the same
# --user-data-dir as the 1st (POS) so Chrome FORWARDS it into the running
# instance instead of starting a separate browser. But forwarding only happens
# once the 1st instance has claimed the profile's process-singleton -- which is
# only true after its window is up. Launch the 2nd window too early and Chrome
# spawns a 2nd, isolated browser process on the same folder, and the two can no
# longer see each other's BroadcastChannel (the original "display won't sync"
# bug). So: wait for the 1st window, then launch the 2nd.
function Wait-ForWindow {
    param($Process, [int]$TimeoutSeconds)
    if (-not $Process) { Start-Sleep -Seconds 3; return }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            if ($Process.HasExited) { break }
            $Process.Refresh()
            if ($Process.MainWindowHandle -ne 0) { break }
        } catch { break }
        Start-Sleep -Milliseconds 200
    }
    # Extra settle so the singleton's hidden message window is fully registered
    # before the forwarded launch tries to find it.
    Start-Sleep -Milliseconds 800
}

# Load the Win32 helpers used to relocate the customer-display window. Because
# the display is FORWARDED into the POS's Chrome instance (required for sync),
# Chrome ignores its --window-position flag and opens it on the primary monitor.
# So we find the new window ourselves and move it onto the secondary monitor.
# Returns $true if the API compiled (older/locked-down machines may refuse).
function Initialize-WinPlace {
    if ('WinPlace' -as [type]) { return $true }
    try {
        Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public class WinPlace {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] private static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

    private static bool IsChromeAppWindow(IntPtr h) {
        if (!IsWindowVisible(h)) return false;
        if (GetWindowTextLength(h) == 0) return false;
        StringBuilder sb = new StringBuilder(64);
        GetClassName(h, sb, sb.Capacity);
        if (sb.ToString() != "Chrome_WidgetWin_1") return false;
        uint pid; GetWindowThreadProcessId(h, out pid);
        try { if (Process.GetProcessById((int)pid).ProcessName.ToLower() != "chrome") return false; }
        catch { return false; }
        return true;
    }
    public static List<long> ChromeWindows() {
        List<long> found = new List<long>();
        EnumWindows(delegate(IntPtr h, IntPtr p) {
            if (IsChromeAppWindow(h)) found.Add(h.ToInt64());
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
        return $true
    } catch {
        Write-Log "Window placement unavailable (Add-Type failed): $_"
        return $false
    }
}

# Find the Chrome window that appeared since $Before was captured (i.e. the
# customer display) and move it to fill the given monitor bounds.
function Move-NewWindowToBounds {
    param([long[]]$Before, [int]$X, [int]$Y, [int]$W, [int]$H)
    $new = $null
    for ($i = 0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 200
        foreach ($h in [WinPlace]::ChromeWindows()) {
            if ($Before -notcontains $h) { $new = $h; break }
        }
        if ($new) { break }
    }
    if (-not $new) { Write-Log 'Could not find the new display window to reposition.'; return }

    $SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010; $SWP_SHOWWINDOW = 0x0040
    $flags = $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW
    [WinPlace]::SetWindowPos([IntPtr]$new, [IntPtr]::Zero, $X, $Y, $W, $H, $flags) | Out-Null
    # Some Chrome builds re-assert their position a beat after the window opens;
    # nudge it once more so it sticks on the secondary monitor.
    Start-Sleep -Milliseconds 700
    [WinPlace]::SetWindowPos([IntPtr]$new, [IntPtr]::Zero, $X, $Y, $W, $H, $flags) | Out-Null
    Write-Log ("Moved display window to {0},{1} {2}x{3}" -f $X, $Y, $W, $H)
}

# ===================== MAIN =====================
try {
    # Make cmdlet errors terminating so the catch below logs and surfaces them,
    # instead of the hidden window dying silently.
    $ErrorActionPreference = 'Stop'

    New-Item -ItemType Directory -Force -Path $ProfileRoot | Out-Null
    Write-Log '--- POS mode starting ---'

    if ($PosUrl -like '*CHANGE-ME*') {
        Show-Error 'POS URL is not configured. Edit $PosUrl in start-pos-mode.ps1.'
        exit 1
    }

    $chrome = Find-Chrome
    if (-not $chrome) {
        Show-Error 'Google Chrome was not found. Install Chrome or set $ChromePath in start-pos-mode.ps1.'
        exit 1
    }
    Write-Log "Chrome: $chrome"

    Add-Type -AssemblyName System.Windows.Forms
    $primary = [System.Windows.Forms.Screen]::PrimaryScreen
    $secondary = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
    Write-Log ("Monitors: {0} (primary {1}x{2}{3})" -f `
        ([System.Windows.Forms.Screen]::AllScreens).Count, $primary.Bounds.Width, $primary.Bounds.Height,
        $(if ($secondary) { ", secondary $($secondary.Bounds.Width)x$($secondary.Bounds.Height)" } else { ', no secondary' }))

    if ($UseKiosk -and $secondary) {
        Write-Log 'WARNING: --kiosk ignores window placement; the customer display may not land on the second monitor. Consider $UseKiosk=$false for dual-monitor tills.'
    }

    Wait-ForHost -Url $PosUrl -WaitSeconds $NetworkWaitSeconds

    # Decide which monitor shows which screen.
    $posScreen = $primary
    $dispScreen = $secondary
    if ($SwapMonitors -and $secondary) { $posScreen = $secondary; $dispScreen = $primary }

    # Both windows MUST share one Chrome profile (--user-data-dir). The POS and
    # the customer display talk to each other only via a same-origin
    # BroadcastChannel ('grid-pos-display'), and BroadcastChannel does not cross
    # profile boundaries: separate --user-data-dir dirs are isolated browser
    # instances that share nothing. Splitting them into 'pos'/'display' profiles
    # silently breaks cart->display sync. Chrome still honours each window's own
    # position/size/fullscreen flags when opened from a shared profile.
    $SharedProfile = Join-Path $ProfileRoot 'profile'

    $pb = $posScreen.Bounds
    $posProc = Start-PosWindow -Chrome $chrome -Url "$PosUrl/" `
        -ProfileDir $SharedProfile `
        -X $pb.X -Y $pb.Y -W $pb.Width -H $pb.Height -Kiosk $UseKiosk

    if ($dispScreen) {
        # Wait for the POS window to come up so the display launch FORWARDS into
        # the same Chrome instance (shared BroadcastChannel) instead of racing it
        # and spawning a second, isolated browser process.
        Wait-ForWindow -Process $posProc -TimeoutSeconds 20
        $sb = $dispScreen.Bounds

        # The forwarded display window ignores --window-position and opens on the
        # primary monitor, so snapshot existing Chrome windows now, then move the
        # newly-created one onto the secondary monitor after it launches.
        $canPlace = Initialize-WinPlace
        $before = if ($canPlace) { [WinPlace]::ChromeWindows() } else { @() }

        Start-PosWindow -Chrome $chrome -Url "$PosUrl/display" `
            -ProfileDir $SharedProfile `
            -X $sb.X -Y $sb.Y -W $sb.Width -H $sb.Height -Kiosk $UseKiosk | Out-Null

        if ($canPlace) {
            Move-NewWindowToBounds -Before $before -X $sb.X -Y $sb.Y -W $sb.Width -H $sb.Height
        } else {
            Write-Log 'Could not auto-place the display; it may open on the primary monitor. Workaround: set the customer-facing monitor as Windows primary, or use $SwapMonitors.'
        }
    } else {
        Write-Log 'Single monitor: customer display not opened.'
    }

    Write-Log 'POS mode launched.'
}
catch {
    Show-Error ("POS mode failed to start: {0}" -f $_.Exception.Message)
    exit 1
}
