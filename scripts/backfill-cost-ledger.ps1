# Backfill COST-LEDGER.csv token/$ columns from a Cursor usage export CSV.
# Export: https://cursor.com/dashboard/usage → Export CSV
# Drop file at runs/{id}/.scratch/cursor-usage-export.csv (gitignored) or pass -UsageCsv
#
# Matching: same model slug (fuzzy) + timestamp within -WindowMinutes of ledger row.
# Only fills blank token/cost cells unless -Overwrite.
#
# Usage:
#   powershell -File scripts/backfill-cost-ledger.ps1 -RunId "…" [-UsageCsv path] [-WindowMinutes 20]

param(
  [Parameter(Mandatory = $true)][string]$RunId,
  [string]$UsageCsv = "",
  [int]$WindowMinutes = 20,
  [switch]$Overwrite,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$runDir = Join-Path $root "runs\$RunId"
$ledgerPath = Join-Path $runDir "results\COST-LEDGER.csv"
if (-not (Test-Path $ledgerPath)) { throw "Missing ledger: $ledgerPath" }

if (-not $UsageCsv) {
  $UsageCsv = Join-Path $runDir ".scratch\cursor-usage-export.csv"
}
if (-not (Test-Path $UsageCsv)) {
  throw @"
Usage CSV not found: $UsageCsv

1. Open https://cursor.com/dashboard/usage
2. Export CSV for the duel date range
3. Save as runs\$RunId\.scratch\cursor-usage-export.csv
4. Re-run this script
"@
}

function Get-Prop($obj, [string[]]$names) {
  foreach ($n in $names) {
    if ($obj.PSObject.Properties.Name -contains $n) {
      $v = $obj.$n
      if ($null -ne $v -and "$v" -ne "") { return "$v" }
    }
  }
  return ""
}

function Parse-Ts([string]$s) {
  if (-not $s) { return $null }
  try {
    return [datetime]::Parse($s, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  } catch {
    try { return [datetime]::Parse($s).ToUniversalTime() } catch { return $null }
  }
}

function Norm-Model([string]$m) {
  if (-not $m) { return "" }
  return ($m.ToLowerInvariant() -replace '[^a-z0-9]+', '')
}

$usageRows = Import-Csv $UsageCsv
$events = @()
foreach ($u in $usageRows) {
  $tsRaw = Get-Prop $u @('Date', 'date', 'datetime_local', 'Timestamp', 'timestamp', 'Time')
  $ts = Parse-Ts $tsRaw
  if (-not $ts -and (Get-Prop $u @('timestamp_ms'))) {
    try { $ts = [datetimeoffset]::FromUnixTimeMilliseconds([int64](Get-Prop $u @('timestamp_ms'))).UtcDateTime } catch {}
  }
  $model = Get-Prop $u @('Model', 'model', 'model_name')
  $inW = Get-Prop $u @('Input (w/ Cache Write)', 'input_w_cache_write', 'cache_write_tokens', 'Cache Write')
  $inN = Get-Prop $u @('Input (w/o Cache Write)', 'input_wo_cache', 'input_tokens', 'Input Tokens')
  $cache = Get-Prop $u @('Cache Read', 'cache_read', 'cache_read_tokens')
  $out = Get-Prop $u @('Output Tokens', 'output_tokens', 'Output')
  $total = Get-Prop $u @('Total Tokens', 'total_tokens', 'Total')
  $cost = Get-Prop $u @('Cost', 'cost', 'cost_usd', 'Cost USD', 'value_cents', 'charged_cents')
  # value_cents → dollars
  if ($cost -match '^\d+$' -and (Get-Prop $u @('value_cents', 'charged_cents'))) {
    $cost = ([double]$cost / 100.0).ToString([cultureinfo]::InvariantCulture)
  }
  if (-not $total) {
    $sum = 0L
    foreach ($x in @($inW, $inN, $cache, $out)) {
      if ($x -match '^\d+$') { $sum += [int64]$x }
    }
    if ($sum -gt 0) { $total = "$sum" }
  }
  $events += [pscustomobject]@{
    Ts = $ts; Model = $model; ModelKey = (Norm-Model $model)
    InW = $inW; InN = $inN; Cache = $cache; Out = $out; Total = $total; Cost = $cost
  }
}

$ledger = Import-Csv $ledgerPath
$filled = 0
$skipped = 0
$unmatched = 0
$window = [timespan]::FromMinutes($WindowMinutes)

for ($i = 0; $i -lt $ledger.Count; $i++) {
  $row = $ledger[$i]
  $hasTokens = ($row.total_tokens -and $row.total_tokens.Trim() -ne "")
  $hasCost = ($row.cost_usd -and $row.cost_usd.Trim() -ne "")
  if ($hasTokens -and $hasCost -and -not $Overwrite) { $skipped++; continue }
  if ($row.role -eq "orchestrate" -and $row.model -eq "orchestrator") { $skipped++; continue }

  $rowTs = Parse-Ts $row.timestamp_utc
  $want = Norm-Model $row.model
  if (-not $rowTs -or -not $want) { $unmatched++; continue }

  $best = $null
  $bestDelta = [timespan]::MaxValue
  foreach ($e in $events) {
    if (-not $e.Ts) { continue }
    if ($e.ModelKey -notlike "*$want*" -and $want -notlike "*$($e.ModelKey)*") { continue }
    $delta = ($e.Ts - $rowTs)
    if ($delta -lt [timespan]::Zero) { $delta = -$delta }
    if ($delta -le $window -and $delta -lt $bestDelta) {
      $best = $e
      $bestDelta = $delta
    }
  }

  if (-not $best) { $unmatched++; continue }

  if ($Overwrite -or -not $hasTokens) {
    if ($best.InW) { $row.input_w_cache_write = $best.InW }
    if ($best.InN) { $row.input_wo_cache = $best.InN }
    if ($best.Cache) { $row.cache_read = $best.Cache }
    if ($best.Out) { $row.output_tokens = $best.Out }
    if ($best.Total) { $row.total_tokens = $best.Total }
  }
  if (($Overwrite -or -not $hasCost) -and $best.Cost) {
    $row.cost_usd = $best.Cost
  }
  $note = [string]$row.notes
  $note = $note -replace 'usage_missing_pending_export;?\s*', ''
  if ($note -and $note -notmatch 'backfilled_from_cursor_csv') {
    $row.notes = "$note; backfilled_from_cursor_csv"
  } elseif (-not $note) {
    $row.notes = "backfilled_from_cursor_csv"
  }
  $ledger[$i] = $row
  $filled++
}

if (-not $DryRun) {
  $ledger | Export-Csv -Path $ledgerPath -NoTypeInformation -Encoding utf8
}

Write-Output "filled=$filled"
Write-Output "skipped=$skipped"
Write-Output "unmatched=$unmatched"
Write-Output "events=$($events.Count)"
Write-Output "ledger=$ledgerPath"
Write-Output "usage_csv=$UsageCsv"
if ($DryRun) { Write-Output "dry_run=1" }
