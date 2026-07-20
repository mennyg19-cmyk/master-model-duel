# Repair COST-LEDGER rows where notes were written into cost_usd (too few commas).
# Safe: only moves cost_usd → notes when cost_usd is non-numeric and total_tokens is blank.
#
#   powershell -File scripts/repair-cost-ledger-columns.ps1 -RunId "…"

param(
  [Parameter(Mandatory = $true)][string]$RunId,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$path = Join-Path $root "runs\$RunId\results\COST-LEDGER.csv"
$rows = Import-Csv $path
$fixed = 0

foreach ($r in $rows) {
  $cost = [string]$r.cost_usd
  $tok = [string]$r.total_tokens
  $notes = [string]$r.notes
  $costLooksLikeNotes = ($cost -ne "" -and $cost -notmatch '^\d+(\.\d+)?$')
  $tokBlank = (-not $tok -or $tok.Trim() -eq "")
  if ($costLooksLikeNotes -and $tokBlank) {
    if ($notes -and $notes.Trim() -ne "") {
      $r.notes = "$notes; $cost"
    } else {
      $r.notes = $cost
    }
    $r.cost_usd = ""
    if ($r.notes -notmatch "usage_missing") {
      $r.notes = "$($r.notes); usage_missing_pending_export"
    }
    $fixed++
  }
}

if (-not $DryRun) {
  $rows | Export-Csv -Path $path -NoTypeInformation -Encoding utf8
}

Write-Output "fixed=$fixed"
Write-Output "path=$path"
