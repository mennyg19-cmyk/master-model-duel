# Add one arm to an existing run (late join)
param(
  [Parameter(Mandatory = $true)]
  [string]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$ArmId,
  [Parameter(Mandatory = $true)]
  [string]$Model,
  [Parameter(Mandatory = $true)]
  [int]$WebPort,
  [Parameter(Mandatory = $true)]
  [int]$DbPort
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

$fam = Get-FamilyId $Model
if (-not $fam) { throw "Unknown model family for $Model - add to catalog/MODEL-FAMILIES.json" }

# Read reviewer + rules from existing kickoff
$reviewerModel = $null
$rulesSelected = @()
$mode = "root"
foreach ($line in Get-Content $kickoffPath) {
  if ($line -match '^\s*reviewer_model:\s*(.+)$') {
    $reviewerModel = $Matches[1].Trim().Trim('"').Trim("'")
  }
  if ($line -match '^\s*rules_selected:\s*$') { $mode = "rules"; continue }
  if ($mode -eq "rules" -and $line -match '^\s*-\s*(.+)$') {
    $rulesSelected += $Matches[1].Trim().Trim('"').Trim("'")
    continue
  }
  if ($mode -eq "rules" -and $line -match '^[a-z_]+:' -and $line -notmatch '^\s') { $mode = "root" }
}
if (-not $reviewerModel) { throw "reviewer_model missing in KICKOFF.yaml" }
if ($rulesSelected.Count -eq 0) { throw "rules_selected missing in KICKOFF.yaml" }

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

- model: (see .scratch/mapping.md)
- web_port: $WebPort
- db_port: $DbPort
- rules: $ruleList
- late_join: true
- Follow protocol/LATE-JOIN.md - shared freezes stay frozen; bonus only where allowed.
"@
Set-Content -Path (Join-Path $armRoot "ARM.md") -Value $armMd -Encoding utf8

# Append mapping
$mapPath = Join-Path $runDir ".scratch\mapping.md"
Add-Content -Path $mapPath -Value "$ArmId`: $Model ($fam) [late_join]" -Encoding utf8

# Append kickoff late_joins note
$stamp = [datetime]::UtcNow.ToString("o")
Add-Content -Path $kickoffPath -Value @"

late_joins:
  - arm_id: $ArmId
    model: $Model
    family: $fam
    web_port: $WebPort
    db_port: $DbPort
    joined_utc: $stamp
"@ -Encoding utf8

$dev = Join-Path $runDir "results\DEVIATIONS.md"
if (-not (Test-Path $dev)) {
  Set-Content -Path $dev -Value "# Deviations`n" -Encoding utf8
}
Add-Content -Path $dev -Value @"

## [$stamp] Late join $ArmId
**What happened:** Added contestant mid-run.
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md.
**Status:** DECIDED
"@ -Encoding utf8

Write-Output "Late join ready: $armRoot"
Write-Output "Model family $fam OK vs reviewer $revFam"
Write-Output "Next: run Tests per protocol/LATE-JOIN.md (frozen shared artifacts + bonus rules)"
