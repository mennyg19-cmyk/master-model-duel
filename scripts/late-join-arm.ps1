# Add one arm to an existing run (late join)
# model_duel: new model, same shared rules
# rules_duel: same contestant_model, new rule pack (-PackId + -Rules)
param(
  [Parameter(Mandatory = $true)]
  [string]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$ArmId,
  [Parameter(Mandatory = $false)]
  [string]$Model,
  [Parameter(Mandatory = $true)]
  [int]$WebPort,
  [Parameter(Mandatory = $true)]
  [int]$DbPort,
  [Parameter(Mandatory = $false)]
  [string]$PackId,
  [Parameter(Mandatory = $false)]
  [string]$Rules
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$runDir = Join-Path $root "runs\$RunId"
if (-not (Test-Path $runDir)) { throw "Run not found: $runDir" }

$kickoffPath = Join-Path $runDir "KICKOFF.yaml"
if (-not (Test-Path $kickoffPath)) { throw "Missing KICKOFF.yaml" }

$families = Get-Content (Join-Path $root "catalog\MODEL-FAMILIES.json") -Raw | ConvertFrom-Json
function Get-FamilyId([string]$slug) {
  foreach ($prop in $families.families.PSObject.Properties) {
    if (@($prop.Value.slugs) -contains $slug) { return $prop.Name }
  }
  return $null
}

$reviewerModel = $null
$runMode = "model_duel"
$contestantModel = $null
$sharedRules = @()
$mode = "root"
foreach ($line in Get-Content $kickoffPath) {
  if ($line -match '^\s*run_mode:\s*(.+)$') {
    $runMode = $Matches[1].Trim().Trim('"').Trim("'")
  }
  if ($line -match '^\s*reviewer_model:\s*(.+)$') {
    $reviewerModel = $Matches[1].Trim().Trim('"').Trim("'")
  }
  if ($line -match '^\s*contestant_model:\s*(.+)$') {
    $contestantModel = $Matches[1].Trim().Trim('"').Trim("'")
  }
  if ($line -match '^\s*rules_selected:\s*$') { $mode = "rules"; continue }
  if ($mode -eq "rules" -and $line -match '^\s*-\s*(.+)$') {
    $sharedRules += $Matches[1].Trim().Trim('"').Trim("'")
    continue
  }
  if ($mode -eq "rules" -and $line -match '^[a-z_]+:' -and $line -notmatch '^\s') { $mode = "root" }
}
if (-not $reviewerModel) { throw "reviewer_model missing in KICKOFF.yaml" }

function Split-Rules([string]$raw) {
  if (-not $raw) { return @() }
  return @($raw -split '[,;\s]+' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
}

$rulesSelected = @()
$effectivePack = "default"
$effectiveModel = $null
$parsedRules = Split-Rules $Rules

if ($runMode -eq "rules_duel") {
  if (-not $PackId) { throw "rules_duel late join requires -PackId" }
  if ($parsedRules.Count -eq 0) { throw "rules_duel late join requires -Rules (comma-separated rule ids)" }
  $effectiveModel = if ($Model) { $Model } else { $contestantModel }
  if (-not $effectiveModel) { throw "rules_duel needs contestant_model in KICKOFF or -Model" }
  if ($Model -and $contestantModel -and ($Model -ne $contestantModel)) {
    throw "rules_duel late join must use the same model ($contestantModel). Got $Model. Start a model_duel instead."
  }
  $rulesSelected = $parsedRules
  $effectivePack = $PackId
}
else {
  if (-not $Model) { throw "model_duel late join requires -Model" }
  $effectiveModel = $Model
  if ($parsedRules.Count -gt 0) {
    $rulesSelected = $parsedRules
    if ($PackId) { $effectivePack = $PackId }
  }
  else {
    if ($sharedRules.Count -eq 0) { throw "rules_selected missing in KICKOFF.yaml" }
    $rulesSelected = @($sharedRules)
  }
}

$fam = Get-FamilyId $effectiveModel
if (-not $fam) { throw "Unknown model family for $effectiveModel - add to catalog/MODEL-FAMILIES.json" }

$revFam = Get-FamilyId $reviewerModel
if ($revFam -eq $fam) {
  throw "Late join model family '$fam' overlaps reviewer family. Pick another contestant model."
}

$armRoot = Join-Path $runDir "arms\$ArmId"
if (Test-Path $armRoot) { throw "Arm already exists: $armRoot" }

$ws = Join-Path $armRoot "workspace"
$rulesDir = Join-Path $armRoot ".cursor\rules"
New-Item -ItemType Directory -Force -Path $ws, $rulesDir | Out-Null

$catalogRules = Join-Path $root "catalog\rules"
foreach ($rid in $rulesSelected) {
  $srcRule = Join-Path $catalogRules "$rid.mdc"
  if (-not (Test-Path $srcRule)) { throw "Missing rule $rid.mdc" }
  Copy-Item $srcRule $rulesDir -Force
}

$templateArm = Join-Path $root "template\arm"
Copy-Item (Join-Path $templateArm "AGENTS.md") (Join-Path $armRoot "AGENTS.md") -Force
Copy-Item (Join-Path $templateArm "CONTESTANT-PROMPT.md") (Join-Path $armRoot "CONTESTANT-PROMPT.md") -Force

$ruleList = $rulesSelected -join ", "
$armMd = @"
# Arm $ArmId (late join)

- run_mode: $runMode
- pack_id: $effectivePack
- model: (see .scratch/mapping.md)
- web_port: $WebPort
- db_port: $DbPort
- rules: $ruleList
- late_join: true
- Follow protocol/LATE-JOIN.md - shared freezes stay frozen; bonus only where allowed.
"@
Set-Content -Path (Join-Path $armRoot "ARM.md") -Value $armMd -Encoding utf8

$mapPath = Join-Path $runDir ".scratch\mapping.md"
Add-Content -Path $mapPath -Value "$ArmId`: model=$effectiveModel family=$fam pack=$effectivePack [late_join]" -Encoding utf8

$stamp = [datetime]::UtcNow.ToString("o")
Add-Content -Path $kickoffPath -Value @"

late_joins:
  - arm_id: $ArmId
    model: $effectiveModel
    family: $fam
    pack_id: $effectivePack
    web_port: $WebPort
    db_port: $DbPort
    joined_utc: $stamp
"@ -Encoding utf8

$dev = Join-Path $runDir "results\DEVIATIONS.md"
if (-not (Test-Path $dev)) {
  Set-Content -Path $dev -Value "# Deviations`n" -Encoding utf8
}
$what = if ($runMode -eq "rules_duel") { "Added rule pack '$effectivePack' mid-run (same model)." } else { "Added contestant mid-run." }
Add-Content -Path $dev -Value @"

## [$stamp] Late join $ArmId
**What happened:** $what
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md.
**Status:** DECIDED
"@ -Encoding utf8

Write-Output "Late join ready: $armRoot"
Write-Output "run_mode=$runMode pack=$effectivePack"
Write-Output "Model family $fam OK vs reviewer $revFam"
Write-Output "Next: run Tests per protocol/LATE-JOIN.md (frozen shared artifacts + bonus rules)"
