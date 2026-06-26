<#
  Grid POS - "POS mode" startup launcher (Windows 7+)

  Opens two clean, full-screen Chrome windows:
    * Primary monitor   -> staff POS  (https://<POS_URL>/)
    * Secondary monitor -> customer display (https://<POS_URL>/display)

  Each window runs in chromeless "app" mode (no address bar / tabs) with its
  own profile, positioned on the correct monitor and started full-screen.
  The second monitor is detected automatically; if only one monitor is found,
  only the staff POS is opened.

  Edit the CONFIG block below, then run via start-pos-mode.bat (which sets the
  PowerShell execution policy for this process only). See README.md for how to
  launch it automatically at login.
#>

# =================== CONFIG ===================
# Base URL where the POS web app is served (no trailing slash).
$PosUrl = 'https://CHANGE-ME.example.com'

# Path to chrome.exe. Leave as $null to auto-detect common install locations.
$ChromePath = $null

# Set $true to use Chrome's locked --kiosk (harder to exit: Ctrl+Alt+Del to get
# Task Manager). $false uses full-screen app mode (Alt+F4 closes a window).
$UseKiosk = $false
# ============================================

$ErrorActionPreference = 'Stop'

function Find-Chrome {
    if ($script:ChromePath -and (Test-Path $script:ChromePath)) { return $script:ChromePath }
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    # Fall back to the registry (App Paths).
    try {
        $reg = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction Stop
        if ($reg.'(default)' -and (Test-Path $reg.'(default)')) { return $reg.'(default)' }
    } catch { }
    return $null
}

# Clear Chrome's "exited_cleanly" flag so an unclean shutdown (e.g. power loss)
# doesn't show the "Restore pages?" bar over the kiosk on next boot.
function Clear-CrashFlag([string]$profileDir) {
    $prefs = Join-Path $profileDir 'Default\Preferences'
    if (-not (Test-Path $prefs)) { return }
    try {
        $json = Get-Content $prefs -Raw
        $json = $json -replace '"exit_type":"[^"]*"', '"exit_type":"Normal"'
        $json = $json -replace '"exited_cleanly":false', '"exited_cleanly":true'
        Set-Content -Path $prefs -Value $json -Encoding UTF8
    } catch { }
}

function Start-PosWindow {
    param(
        [string]$Chrome,
        [string]$Url,
        [string]$ProfileDir,
        [int]$X, [int]$Y, [int]$W, [int]$H,
        [bool]$Kiosk
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
        '--hide-crash-restore-bubble',
        '--disable-features=TranslateUI,Translate,InfiniteSessionRestore',
        '--disable-pinch',
        '--overscroll-history-navigation=0',
        '--check-for-update-interval=31536000',
        '--disable-component-update'
    )
    if ($Kiosk) { $chromeArgs += '--kiosk' } else { $chromeArgs += '--start-fullscreen' }

    Start-Process -FilePath $Chrome -ArgumentList $chromeArgs | Out-Null
}

# --- locate Chrome ---
$chrome = Find-Chrome
if (-not $chrome) {
    [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
    [System.Windows.Forms.MessageBox]::Show(
        'Google Chrome was not found. Install Chrome or set $ChromePath in start-pos-mode.ps1.',
        'Grid POS - POS mode') | Out-Null
    exit 1
}

# --- enumerate monitors ---
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
$primary = [System.Windows.Forms.Screen]::PrimaryScreen
$secondary = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1

$profileRoot = Join-Path $env:LOCALAPPDATA 'GridPos'

# --- staff POS on the primary monitor ---
$pb = $primary.Bounds
Start-PosWindow -Chrome $chrome -Url "$PosUrl/" `
    -ProfileDir (Join-Path $profileRoot 'pos') `
    -X $pb.X -Y $pb.Y -W $pb.Width -H $pb.Height -Kiosk $UseKiosk

# --- customer display on the secondary monitor (if present) ---
if ($secondary) {
    $sb = $secondary.Bounds
    Start-Sleep -Milliseconds 800   # let the first window claim the primary first
    Start-PosWindow -Chrome $chrome -Url "$PosUrl/display" `
        -ProfileDir (Join-Path $profileRoot 'display') `
        -X $sb.X -Y $sb.Y -W $sb.Width -H $sb.Height -Kiosk $UseKiosk
}
