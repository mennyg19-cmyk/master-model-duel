# List duel model options for the current host (for AskQuestion multi-select / fallback).
# Usage: powershell -File scripts/list-model-options.ps1 [-DuelHost cursor|opencode|auto]
param(
  [ValidateSet("cursor", "opencode", "generic", "auto")]
  [string]$DuelHost = "auto"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if ($DuelHost -eq "auto") {
  $detect = & (Join-Path $PSScriptRoot "detect-host.ps1")
  foreach ($line in $detect) {
    if ($line -match "^host=(.+)$") { $DuelHost = $Matches[1] }
  }
}
if ($DuelHost -eq "generic") { $DuelHost = "cursor" }

$families = Get-Content (Join-Path $root "catalog\MODEL-FAMILIES.json") -Raw | ConvertFrom-Json
$i = 1
Write-Output "host=$DuelHost"
Write-Output "instruction=Select 2+ models. AskQuestion: allow_multiple=true. Fallback: reply with comma-separated ids (e.g. 1,3,5) or slugs."
Write-Output ""

foreach ($prop in $families.families.PSObject.Properties) {
  $fam = $prop.Value
  $ids = @()
  if ($fam.hosts -and $fam.hosts.$DuelHost) {
    $ids = @($fam.hosts.$DuelHost)
  }
  elseif ($DuelHost -eq "cursor" -and $fam.slugs) {
    $ids = @($fam.slugs)
  }
  foreach ($id in $ids) {
    if (-not $id) { continue }
    $label = "$($fam.label): $id"
    Write-Output ("{0}`t{1}`t{2}`t{3}" -f $i, $prop.Name, $id, $label)
    $i++
  }
}
