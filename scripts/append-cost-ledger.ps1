# Append one row to runs/{run_id}/results/COST-LEDGER.csv
# Orchestrator MUST call this after every spawn (contestant or reviewer).
# Missing token/$ is OK — still append; put usage_missing in notes.
#
# Usage:
#   powershell -File scripts/append-cost-ledger.ps1 `
#     -RunId "2026-07-20-1748-tomchei-shabbos-website-model_duel" `
#     -Test "1a" -ArmId "arm-01" -Role "inventory" -Model "gpt-5.6-sol-medium" `
#     -CostUsd 1.23 -TotalTokens 50000 -Notes "job=product"
#
# Prints: appended=1 path=... rows=N

param(
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][string]$Test,
  [Parameter(Mandatory = $true)][string]$ArmId,
  [Parameter(Mandatory = $true)][string]$Role,
  [Parameter(Mandatory = $true)][string]$Model,
  [string]$Phase = "",
  [string]$AgentId = "",
  [string]$Kind = "",
  [string]$InputWithCacheWrite = "",
  [string]$InputWithoutCache = "",
  [string]$CacheRead = "",
  [string]$OutputTokens = "",
  [string]$TotalTokens = "",
  [string]$CostUsd = "",
  [string]$Notes = "",
  [string]$TimestampUtc = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$ledger = Join-Path $root "runs\$RunId\results\COST-LEDGER.csv"
if (-not (Test-Path $ledger)) {
  throw "COST-LEDGER.csv not found: $ledger (bootstrap the run first)"
}

if (-not $TimestampUtc) {
  $TimestampUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

function Esc([string]$v) {
  if ($null -eq $v) { return "" }
  $s = [string]$v
  if ($s -match '[,"\r\n]') {
    return '"' + ($s.Replace('"', '""')) + '"'
  }
  return $s
}

$usageBlank = (-not $CostUsd -or $CostUsd.Trim() -eq "") -and (-not $TotalTokens -or $TotalTokens.Trim() -eq "")
if ($usageBlank -and ($Notes -notmatch "usage_missing")) {
  if ($Notes) { $Notes = "$Notes; usage_missing_pending_export" }
  else { $Notes = "usage_missing_pending_export" }
}

$row = @(
  $TimestampUtc, $RunId, $Test, $ArmId, $Phase, $Role, $Model, $AgentId, $Kind,
  $InputWithCacheWrite, $InputWithoutCache, $CacheRead, $OutputTokens, $TotalTokens, $CostUsd, $Notes
) | ForEach-Object { Esc $_ }

$line = ($row -join ",")
Add-Content -Path $ledger -Value $line -Encoding utf8

$n = (Get-Content $ledger | Measure-Object -Line).Lines - 1
Write-Output "appended=1"
Write-Output "path=$ledger"
Write-Output "rows=$n"
if ($usageBlank) {
  Write-Output "usage=MISSING"
  Write-Output "warn=Pass -TotalTokens and/or -CostUsd from Cursor Usage Summary / OpenCode output. Blank usage is provisional only; gate needs backfill via scripts/backfill-cost-ledger.ps1"
} else {
  Write-Output "usage=present"
}
