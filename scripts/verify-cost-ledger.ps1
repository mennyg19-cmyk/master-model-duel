# Gate check: COST-LEDGER must have data rows; optionally require min rows / roles / usage.
# Exit 0 = ok; exit 1 = gate fail (print missing=).
#
#   powershell -File scripts/verify-cost-ledger.ps1 -RunId "..." [-MinRows 1] [-RequireRoles inventory,reconcile] [-RequireUsage]

param(
  [Parameter(Mandatory = $true)][string]$RunId,
  [int]$MinRows = 1,
  [string]$RequireRoles = "",
  [switch]$RequireUsage
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$ledger = Join-Path $root "runs\$RunId\results\COST-LEDGER.csv"

if (-not (Test-Path $ledger)) {
  Write-Output "ok=false"
  Write-Output "missing=COST-LEDGER.csv"
  exit 1
}

$lines = Get-Content $ledger
if ($lines.Count -lt 2) {
  Write-Output "ok=false"
  Write-Output "missing=no_data_rows"
  Write-Output "rows=0"
  exit 1
}

$data = $lines | Select-Object -Skip 1 | Where-Object { $_.Trim() -ne "" }
$rowCount = @($data).Count
Write-Output "rows=$rowCount"

if ($rowCount -lt $MinRows) {
  Write-Output "ok=false"
  Write-Output "missing=min_rows (have $rowCount need $MinRows)"
  exit 1
}

if ($RequireRoles) {
  $needed = $RequireRoles.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $rolesSeen = @{}
  foreach ($line in $data) {
    $parts = $line.Split(",")
    if ($parts.Count -ge 6) { $rolesSeen[$parts[5]] = $true }
  }
  $miss = @()
  foreach ($r in $needed) {
    if (-not $rolesSeen.ContainsKey($r)) { $miss += $r }
  }
  if ($miss.Count -gt 0) {
    Write-Output "ok=false"
    Write-Output ("missing_roles=" + ($miss -join ","))
    exit 1
  }
}

if ($RequireUsage) {
  $csv = Import-Csv $ledger
  $blank = @()
  foreach ($r in $csv) {
    if ($r.role -eq "orchestrate" -and $r.model -eq "orchestrator") { continue }
    $hasTokens = ($r.total_tokens -and $r.total_tokens.Trim() -ne "")
    $hasCost = ($r.cost_usd -and $r.cost_usd.Trim() -ne "")
    if (-not $hasTokens -and -not $hasCost) {
      $blank += "$($r.test)/$($r.arm_id)/$($r.role)/$($r.timestamp_utc)"
    }
  }
  Write-Output "usage_blank=$($blank.Count)"
  if ($blank.Count -gt 0) {
    Write-Output "ok=false"
    Write-Output "missing=usage_tokens_or_cost"
    Write-Output "hint=Pass -TotalTokens/-CostUsd on append, or run scripts/backfill-cost-ledger.ps1 after Cursor usage CSV export"
    Write-Output ("blank_sample=" + (($blank | Select-Object -First 5) -join " | "))
    exit 1
  }
}

Write-Output "ok=true"
exit 0
