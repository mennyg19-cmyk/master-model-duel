# Bootstrap an isolated duel run from KICKOFF.yaml
param(
  [Parameter(Mandatory = $true)]
  [string]$KickoffYaml
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Test-Path $KickoffYaml)) { throw "Kickoff not found: $KickoffYaml" }

$rawLines = Get-Content $KickoffYaml
$runId = $null
foreach ($line in $rawLines) {
  if ($line -match '^\s*run_id:\s*(.+)$') {
    $runId = $Matches[1].Trim().Trim('"').Trim("'")
    break
  }
}
if (-not $runId) { throw "KICKOFF.yaml missing run_id" }

$runDir = Join-Path $root "runs\$runId"
$catalogRules = Join-Path $root "catalog\rules"
$templateArm = Join-Path $root "template\arm"
$familiesPath = Join-Path $root "catalog\MODEL-FAMILIES.json"
$families = Get-Content $familiesPath -Raw | ConvertFrom-Json

function Get-FamilyId([string]$slug) {
  foreach ($prop in $families.families.PSObject.Properties) {
    $slugs = @($prop.Value.slugs)
    if ($slugs -contains $slug) { return $prop.Name }
  }
  return $null
}

$contestants = @()
$rulesSelected = @()
$reviewerModel = $null
$source = $null
$mode = "root"
$current = $null

foreach ($line in $rawLines) {
  if ($line -match '^\s*#') { continue }
  if ($line -match '^\s*source_codebase:\s*(.+)$') {
    $source = $Matches[1].Trim().Trim('"').Trim("'")
    continue
  }
  if ($line -match '^\s*reviewer_model:\s*(.+)$') {
    $reviewerModel = $Matches[1].Trim().Trim('"').Trim("'")
    continue
  }
  if ($line -match '^\s*rules_selected:\s*$') { $mode = "rules"; continue }
  if ($line -match '^\s*contestants:\s*$') { $mode = "contestants"; continue }

  if ($mode -eq "rules" -and $line -match '^\s*-\s*(.+)$') {
    $rulesSelected += $Matches[1].Trim().Trim('"').Trim("'")
    continue
  }

  if ($mode -eq "contestants" -and $line -match '^\s*-\s*arm_id:\s*(.+)$') {
    if ($null -ne $current) { $contestants += $current }
    $current = [ordered]@{
      arm_id   = $Matches[1].Trim().Trim('"').Trim("'")
      model    = $null
      web_port = 0
      db_port  = 0
      family   = $null
    }
    continue
  }

  if ($mode -eq "contestants" -and $null -ne $current) {
    if ($line -match '^\s*model:\s*(.+)$') {
      $current.model = $Matches[1].Trim().Trim('"').Trim("'")
      continue
    }
    if ($line -match '^\s*web_port:\s*(\d+)$') {
      $current.web_port = [int]$Matches[1]
      continue
    }
    if ($line -match '^\s*db_port:\s*(\d+)$') {
      $current.db_port = [int]$Matches[1]
      continue
    }
  }

  if ($line -match '^[a-z_]+:' -and $line -notmatch '^\s') {
    if ($mode -eq "contestants" -and $null -ne $current) {
      $contestants += $current
      $current = $null
    }
    if ($mode -eq "rules" -and $line -notmatch 'rules_selected') { $mode = "root" }
  }
}
if ($null -ne $current) { $contestants += $current }

if (-not $reviewerModel) { throw "reviewer_model required" }
if (-not $source) { throw "source_codebase required" }
if ($contestants.Count -lt 2) { throw "Need at least 2 contestants" }
if (-not (Test-Path $source)) { Write-Warning "source_codebase path not found: $source (continuing)" }

$reviewerFamily = Get-FamilyId $reviewerModel
if (-not $reviewerFamily) {
  throw "Unknown reviewer slug family: $reviewerModel - add to catalog/MODEL-FAMILIES.json"
}

$contestantFamilies = @()
foreach ($c in $contestants) {
  $fam = Get-FamilyId $c.model
  if (-not $fam) { throw "Unknown contestant slug family: $($c.model)" }
  $c.family = $fam
  $contestantFamilies += $fam
}
if ($contestantFamilies -contains $reviewerFamily) {
  $joined = $contestantFamilies -join ", "
  throw "Reviewer family '$reviewerFamily' overlaps contestants ($joined). Pick another reviewer."
}

if (Test-Path $runDir) { throw "Run already exists: $runDir" }

New-Item -ItemType Directory -Force -Path $runDir | Out-Null
@(
  (Join-Path $runDir "shared"),
  (Join-Path $runDir "results"),
  (Join-Path $runDir "results\reviews"),
  (Join-Path $runDir ".scratch"),
  (Join-Path $runDir "arms")
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

Copy-Item $KickoffYaml (Join-Path $runDir "KICKOFF.yaml") -Force

$ledger = Join-Path $runDir "results\COST-LEDGER.csv"
$header = "timestamp_utc,run_id,test,arm_id,phase,role,model,agent_id,kind,input_w_cache_write,input_wo_cache,cache_read,output_tokens,total_tokens,cost_usd,notes"
Set-Content -Path $ledger -Encoding utf8 -Value $header

$mapLines = @(
  "# Mapping - do not commit until FINAL-REPORT",
  "reviewer: $reviewerModel ($reviewerFamily)"
)
foreach ($c in $contestants) {
  $mapLines += "$($c.arm_id): $($c.model) ($($c.family))"
}
Set-Content -Path (Join-Path $runDir ".scratch\mapping.md") -Value ($mapLines -join "`n") -Encoding utf8

$sourceMd = @"
# Source codebase (Test 1 only)

Path: ``$source``

Builders must NOT receive this path after Test 1. Inventory agents read it read-only during Test 1 only.
"@
Set-Content -Path (Join-Path $runDir "SOURCE.md") -Value $sourceMd -Encoding utf8

foreach ($c in $contestants) {
  $armRoot = Join-Path $runDir "arms\$($c.arm_id)"
  $ws = Join-Path $armRoot "workspace"
  $rulesDir = Join-Path $armRoot ".cursor\rules"
  New-Item -ItemType Directory -Force -Path $ws, $rulesDir | Out-Null

  foreach ($rid in $rulesSelected) {
    $srcRule = Join-Path $catalogRules "$rid.mdc"
    if (-not (Test-Path $srcRule)) {
      $alt = Get-ChildItem $catalogRules -Filter "*.mdc" | Where-Object { $_.BaseName -eq $rid } | Select-Object -First 1
      if ($alt) { $srcRule = $alt.FullName }
    }
    if (-not (Test-Path $srcRule)) {
      throw "Rule file missing for id '$rid' (expected catalog/rules/$rid.mdc)"
    }
    Copy-Item $srcRule $rulesDir -Force
  }

  $ruleList = $rulesSelected -join ", "
  $armMd = @"
# Arm $($c.arm_id)

- model: (hidden from reviewers - see .scratch/mapping.md)
- web_port: $($c.web_port)
- db_port: $($c.db_port)
- rules: $ruleList
- workspace: ``workspace/`` (build only here)
- Do not run git. Do not touch ``../../results``.
"@
  Set-Content -Path (Join-Path $armRoot "ARM.md") -Value $armMd -Encoding utf8

  Copy-Item (Join-Path $templateArm "AGENTS.md") (Join-Path $armRoot "AGENTS.md") -Force
  $promptSrc = Join-Path $templateArm "CONTESTANT-PROMPT.md"
  if (Test-Path $promptSrc) {
    Copy-Item $promptSrc (Join-Path $armRoot "CONTESTANT-PROMPT.md") -Force
  }
}

$armIds = ($contestants | ForEach-Object { $_.arm_id }) -join ", "
$ruleList = $rulesSelected -join ", "
$runReadme = @"
# Run ``$runId``

Isolated agent duel archive. Do not mix with other folders under ``runs/``.

| Item | Value |
|---|---|
| Source | ``$source`` |
| Reviewer | ``$reviewerModel`` ($reviewerFamily) |
| Contestants | $($contestants.Count) arms |
| Rules | $ruleList |

## Layout

- ``KICKOFF.yaml`` - frozen kickoff answers
- ``SOURCE.md`` - Test 1 codebase pointer
- ``arms/{arm_id}/`` - contestant sandbox (rules + workspace)
- ``shared/`` - reconciled inventory, merged plan, phase cuts
- ``results/`` - reviews, scores, COST-LEDGER.csv, FINAL-REPORT
- ``.scratch/`` - mapping + temp (gitignored)

## Next

Orchestrator: start **Test 1** per ``protocol/EXPERIMENT-PLAN.md``.
"@
Set-Content -Path (Join-Path $runDir "README.md") -Value $runReadme -Encoding utf8

Write-Output "Bootstrapped $runDir"
Write-Output "Arms: $armIds"
Write-Output "Reviewer family OK: $reviewerFamily not in contestant set"
Write-Output "Rules: $ruleList"
