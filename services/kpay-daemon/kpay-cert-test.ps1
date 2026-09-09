<#
  KPay certification test harness (Grid POS)
  =========================================
  Drives the four transaction types KPay requires for certification against a
  physical KPay terminal on your LAN, via the kpay-daemon local-test server.

  It does NOT talk to Railway. Start the daemon in local-test mode first:

      C:\KPayDaemon\.env  ->  KPAY_LOCAL_TEST=1
                              KPAT_TERMINAL_IP=<terminal LAN IP>
                              KPAT_APP_ID=<kpay test app id>
                              KPAT_APP_SECRET=<kpay test secret>
                              KPAT_MANAGER_PASSWORD=<kpay manager pw>
      kpay-daemon.exe                      # listens on http://localhost:9000

  Then run this script (double-click kpay-cert-test.bat, or run it in PowerShell).
  Every response is printed AND saved as timestamped JSON under .\kpay-cert-evidence\
  so you have a clean record to submit to KPay.

  Amounts are entered in dollars (e.g. 1.00) and sent to the terminal as cents.
  Currency is SGD (702). payment_type: 1=card, 13=PayNow, 14=Alipay, 15=WeChat,
  3/16=QR. Certification is usually done on card (1).
#>

$ErrorActionPreference = 'Stop'
$Base = 'http://localhost:9000'
$EvidenceDir = Join-Path $PSScriptRoot 'kpay-cert-evidence'
if (-not (Test-Path $EvidenceDir)) { New-Item -ItemType Directory -Path $EvidenceDir | Out-Null }

# Remembered between actions so a cancel/refund can reuse the last sale automatically.
$script:LastTradeNo      = $null
$script:LastTransactionNo = $null
$script:LastRefNo        = $null

function New-TradeNo {
  # Unique out_trade_no per attempt: CERT-YYYYMMDD-HHMMSS-<4 rand>
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $rand  = -join ((48..57 + 65..90) | Get-Random -Count 4 | ForEach-Object {[char]$_})
  return "CERT-$stamp-$rand"
}

function Save-Evidence($label, $requestObj, $responseObj) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $file  = Join-Path $EvidenceDir "$stamp-$label.json"
  $record = [ordered]@{
    label     = $label
    timestamp = (Get-Date).ToString('o')
    request   = $requestObj
    response  = $responseObj
  }
  $record | ConvertTo-Json -Depth 12 | Set-Content -Path $file -Encoding UTF8
  Write-Host "  evidence saved: $file" -ForegroundColor DarkGray
}

function Invoke-Kpay($path, $bodyObj, $label) {
  $json = $bodyObj | ConvertTo-Json -Depth 8 -Compress
  Write-Host ""
  Write-Host "-> POST $Base$path" -ForegroundColor Cyan
  Write-Host "   $json" -ForegroundColor DarkCyan
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$Base$path" -Body $json -ContentType 'application/json' -TimeoutSec 90
  } catch {
    Write-Host "REQUEST FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Is the daemon running in local-test mode on :9000? (KPAY_LOCAL_TEST=1)" -ForegroundColor Yellow
    Save-Evidence $label $bodyObj @{ error = $_.Exception.Message }
    return $null
  }
  $pretty = $resp | ConvertTo-Json -Depth 12
  Write-Host "<- response:" -ForegroundColor Green
  Write-Host $pretty
  Save-Evidence $label $bodyObj $resp

  # Surface any error event so a failed cert case is obvious.
  foreach ($ev in $resp.events) {
    if ($ev.type -eq 'error') {
      Write-Host "   ** KPay error code $($ev.code): $($ev.message)" -ForegroundColor Red
    }
    if ($ev.transaction_no) { $script:LastTransactionNo = $ev.transaction_no }
    if ($ev.ref_no)         { $script:LastRefNo = $ev.ref_no }
  }
  return $resp
}

function Do-Sale {
  $dollars = Read-Host "Sale amount in dollars (e.g. 1.00)"
  $cents = [int64]([math]::Round([double]$dollars * 100))
  $ptRaw = Read-Host "payment_type [1=card, 13=PayNow, 14=Alipay, 15=WeChat, 3/16=QR] (Enter=1)"
  $pt = if ([string]::IsNullOrWhiteSpace($ptRaw)) { 1 } else { [int]$ptRaw }
  $no = New-TradeNo
  $script:LastTradeNo = $no
  Write-Host "out_trade_no for this sale: $no  ($cents cents, type $pt)" -ForegroundColor Yellow
  Write-Host "Follow the prompts on the KPay terminal to complete/approve the payment..." -ForegroundColor Yellow
  $body = [ordered]@{ out_trade_no = $no; amount_cents = $cents; payment_type = $pt }
  Invoke-Kpay '/kpay/sales' $body 'sale' | Out-Null
}

function Do-Query {
  $no = Read-Host "out_trade_no to query (Enter = last sale: $script:LastTradeNo)"
  if ([string]::IsNullOrWhiteSpace($no)) { $no = $script:LastTradeNo }
  if (-not $no) { Write-Host "No trade number known yet. Run a sale first." -ForegroundColor Yellow; return }
  $body = [ordered]@{ out_trade_no = $no }
  Invoke-Kpay '/kpay/query' $body 'query' | Out-Null
}

function Do-Cancel {
  $origin = Read-Host "origin_out_trade_no to cancel/void (Enter = last sale: $script:LastTradeNo)"
  if ([string]::IsNullOrWhiteSpace($origin)) { $origin = $script:LastTradeNo }
  if (-not $origin) { Write-Host "No sale to cancel yet. Run a sale first." -ForegroundColor Yellow; return }
  $no = New-TradeNo
  Write-Host "cancel out_trade_no: $no  (voiding $origin)" -ForegroundColor Yellow
  $body = [ordered]@{ out_trade_no = $no; origin_out_trade_no = $origin }
  Invoke-Kpay '/kpay/cancel' $body 'cancel' | Out-Null
}

function Do-Refund {
  $origin = Read-Host "origin_out_trade_no to refund (Enter = last sale: $script:LastTradeNo)"
  if ([string]::IsNullOrWhiteSpace($origin)) { $origin = $script:LastTradeNo }
  if (-not $origin) { Write-Host "No sale to refund yet. Run a sale first." -ForegroundColor Yellow; return }
  $dollars = Read-Host "Refund amount in dollars (e.g. 1.00)"
  $cents = [int64]([math]::Round([double]$dollars * 100))
  $ref = Read-Host "ref_no from the original sale's query result (Enter = last seen: $script:LastRefNo)"
  if ([string]::IsNullOrWhiteSpace($ref)) { $ref = $script:LastRefNo }
  $tx  = Read-Host "transaction_no from the original sale's query result (Enter = last seen: $script:LastTransactionNo)"
  if ([string]::IsNullOrWhiteSpace($tx)) { $tx = $script:LastTransactionNo }
  $commit = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $no = New-TradeNo
  Write-Host "refund out_trade_no: $no  (refunding $origin, $cents cents)" -ForegroundColor Yellow
  $body = [ordered]@{
    out_trade_no        = $no
    origin_out_trade_no = $origin
    refund_amount_cents = $cents
    refund_type         = 1
    ref_no              = $ref
    transaction_no      = $tx
    commit_time         = $commit
  }
  Invoke-Kpay '/kpay/refund' $body 'refund' | Out-Null
}

function Test-Daemon {
  try {
    Invoke-WebRequest -Uri "$Base/kpay/query" -Method Post -Body '{}' -ContentType 'application/json' -TimeoutSec 5 -UseBasicParsing | Out-Null
    return $true
  } catch {
    # A reachable daemon returns 200 with an error event even for a bad body;
    # only a connection failure means it's not listening.
    if ($_.Exception.Response) { return $true }
    return $false
  }
}

Write-Host "==================================================" -ForegroundColor White
Write-Host " KPay Certification Test Harness  (Grid POS)" -ForegroundColor White
Write-Host "==================================================" -ForegroundColor White
Write-Host "Daemon endpoint: $Base   (local-test mode, KPAY_LOCAL_TEST=1)"
Write-Host "Evidence folder: $EvidenceDir"
Write-Host ""
if (Test-Daemon) {
  Write-Host "Daemon is reachable on :9000." -ForegroundColor Green
} else {
  Write-Host "WARNING: daemon not reachable on :9000." -ForegroundColor Red
  Write-Host "Start it first:  set KPAY_LOCAL_TEST=1 in .env, then run kpay-daemon.exe" -ForegroundColor Yellow
}

while ($true) {
  Write-Host ""
  Write-Host "--- Choose a KPay certification action ---" -ForegroundColor White
  Write-Host "  1) Sale        (start a payment on the terminal)"
  Write-Host "  2) Query       (check a sale's result)"
  Write-Host "  3) Cancel/Void (reverse an unsettled sale)"
  Write-Host "  4) Refund      (refund a settled sale)"
  Write-Host "  5) Open evidence folder"
  Write-Host "  Q) Quit"
  $choice = Read-Host "Selection"
  switch ($choice.ToUpper()) {
    '1' { Do-Sale }
    '2' { Do-Query }
    '3' { Do-Cancel }
    '4' { Do-Refund }
    '5' { Start-Process $EvidenceDir }
    'Q' { Write-Host "Done. Evidence is in $EvidenceDir"; break }
    default { Write-Host "Unknown selection." -ForegroundColor Yellow }
  }
  if ($choice.ToUpper() -eq 'Q') { break }
}
