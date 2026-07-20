# Bootstrap an isolated duel run from KICKOFF.yaml
# Supports run_mode: model_duel | rules_duel
# Accepts either expanded contestants[] or rules_duel rule_packs[] (+ contestant_model).
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
$runMode = "model_duel"
foreach ($line in $rawLines) {
  if ($line -match '^\s*run_id:\s*(.+)$') {
    $runId = $Matches[1].Trim().Trim('"').Trim("'")
  }
  if ($line -match '^\s*run_mode:\s*(.+)$') {
    $runMode = $Matches[1].Trim().Trim('"').Trim("'")
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
    if (@($prop.Value.slugs) -contains $slug) { return $prop.Name }
  }
  return $null
}

function Rules-Key($list) {
  return (($list | Sort-Object) -join ",")
}

$contestants = @()
$rulePacks = @()
$sharedRules = @()
$reviewerModel = $null
$source = $null
$contestantModel = $null
$mode = "root"
$current = $null
$currentPack = $null

foreach ($line in $rawLines) {
  if ($line -match '^\s*#') { continue }
  if ($line -match '^\s*source_codebase:\s*(.+)$') {
    $source = $Matches[1].Trim().Trim('"').Trim("'"); continue
  }
  if ($line -match '^\s*reviewer_model:\s*(.+)$') {
    $reviewerModel = $Matches[1].Trim().Trim('"').Trim("'"); continue
  }
  if ($line -match '^\s*contestant_model:\s*(.+)$') {
    $contestantModel = $Matches[1].Trim().Trim('"').Trim("'"); continue
  }
  if ($line -match '^\s*rules_selected:\s*$') { $mode = "shared_rules"; continue }
  if ($line -match '^\s*rule_packs:\s*$') { $mode = "rule_packs"; continue }
  if ($line -match '^\s*contestants:\s*$') { $mode = "contestants"; continue }

  if ($mode -eq "shared_rules" -and $line -match '^\s*-\s*(.+)$') {
    $sharedRules += $Matches[1].Trim().Trim('"').Trim("'"); continue
  }

  if ($mode -eq "rule_packs" -or $mode -eq "pack_rules") {
    if ($line -match '^\s*-\s*pack_id:\s*(.+)$') {
      if ($null -ne $currentPack) { $rulePacks += $currentPack }
      $currentPack = [ordered]@{
        pack_id = $Matches[1].Trim().Trim('"').Trim("'")
        label   = $null
        rules   = @()
      }
      $mode = "rule_packs"
      continue
    }
    if ($null -ne $currentPack) {
      if ($line -match '^\s*label:\s*(.+)$') {
        $currentPack.label = $Matches[1].Trim().Trim('"').Trim("'"); continue
      }
      if ($line -match '^\s*rules:\s*$') { $mode = "pack_rules"; continue }
      if ($mode -eq "pack_rules" -and $line -match '^\s*-\s*(.+)$') {
        $currentPack.rules += $Matches[1].Trim().Trim('"').Trim("'"); continue
      }
    }
  }

  if ($mode -eq "contestants" -and $line -match '^\s*-\s*arm_id:\s*(.+)$') {
    if ($null -ne $current) { $contestants += $current }
    $current = [ordered]@{
      arm_id   = $Matches[1].Trim().Trim('"').Trim("'")
      model    = $null
      web_port = 0
      db_port  = 0
      family   = $null
      pack_id  = $null
      rules    = @()
    }
    continue
  }

  if (($mode -eq "contestants" -or $mode -eq "arm_rules") -and $null -ne $current) {
    if ($line -match '^\s*model:\s*(.+)$') {
      $current.model = $Matches[1].Trim().Trim('"').Trim("'"); $mode = "contestants"; continue
    }
    if ($line -match '^\s*pack_id:\s*(.+)$') {
      $current.pack_id = $Matches[1].Trim().Trim('"').Trim("'"); $mode = "contestants"; continue
    }
    if ($line -match '^\s*web_port:\s*(\d+)$') {
      $current.web_port = [int]$Matches[1]; $mode = "contestants"; continue
    }
    if ($line -match '^\s*db_port:\s*(\d+)$') {
      $current.db_port = [int]$Matches[1]; $mode = "contestants"; continue
    }
    if ($line -match '^\s*rules:\s*$' -or $line -match '^\s*rules_selected:\s*$') {
      $mode = "arm_rules"; continue
    }
    if ($mode -eq "arm_rules" -and $line -match '^\s*-\s*(.+)$') {
      $current.rules += $Matches[1].Trim().Trim('"').Trim("'"); continue
    }
  }

  if ($line -match '^[a-z_]+:' -and $line -notmatch '^\s') {
    if (($mode -eq "contestants" -or $mode -eq "arm_rules") -and $null -ne $current) {
      $contestants += $current
      $current = $null
    }
    if (($mode -eq "rule_packs" -or $mode -eq "pack_rules") -and $null -ne $currentPack) {
      $rulePacks += $currentPack
      $currentPack = $null
    }
    $mode = "root"
  }
}
if ($null -ne $current) { $contestants += $current }
if ($null -ne $currentPack) { $rulePacks += $currentPack }

if (-not $reviewerModel) { throw "reviewer_model required" }
if (-not $source) { throw "source_codebase required" }
if (-not (Test-Path $source)) { Write-Warning "source_codebase path not found: $source (continuing)" }

# Expand rule_packs → contestants when arms not pre-listed
if ($contestants.Count -eq 0) {
  if ($rulePacks.Count -lt 2) {
    throw "Need contestants[] (model_duel) or at least 2 rule_packs[] (rules_duel)"
  }
  if (-not $contestantModel) { throw "contestant_model required when expanding rule_packs" }
  $i = 1
  foreach ($p in $rulePacks) {
    if ($p.rules.Count -eq 0) { throw "Pack $($p.pack_id) has empty rules" }
    $contestants += [ordered]@{
      arm_id   = ("arm-{0:D2}" -f $i)
      model    = $contestantModel
      web_port = 3100 + $i
      db_port  = 4100 + $i
      family   = $null
      pack_id  = $p.pack_id
      rules    = @($p.rules)
    }
    $i++
  }
}

if ($contestants.Count -lt 2) { throw "Need at least 2 contestants/packs" }

foreach ($c in $contestants) {
  if (-not $c.model) {
    if ($contestantModel) { $c.model = $contestantModel }
    else { throw "Arm $($c.arm_id) missing model" }
  }
  if ($c.rules.Count -eq 0) {
    if ($sharedRules.Count -eq 0) { throw "Arm $($c.arm_id) has no rules and rules_selected is empty" }
    $c.rules = @($sharedRules)
  }
  if (-not $c.pack_id) { $c.pack_id = "default" }
  if ($c.web_port -le 0 -or $c.db_port -le 0) {
    throw "Arm $($c.arm_id) needs web_port and db_port"
  }
}

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
$contestantFamilies = @($contestantFamilies | Select-Object -Unique)
if ($contestantFamilies -contains $reviewerFamily) {
  $joined = $contestantFamilies -join ", "
  throw "Reviewer family '$reviewerFamily' overlaps contestants ($joined). Pick another reviewer."
}

if ($runMode -eq "rules_duel") {
  $models = @($contestants | ForEach-Object { $_.model } | Select-Object -Unique)
  if ($models.Count -ne 1) {
    throw "rules_duel requires exactly one contestant model across arms (found: $($models -join ', '))"
  }
  $keys = @($contestants | ForEach-Object { Rules-Key $_.rules } | Select-Object -Unique)
  if ($keys.Count -lt 2) {
    throw "rules_duel requires at least two different rule packs"
  }
}
elseif ($runMode -ne "model_duel") {
  throw "Unknown run_mode: $runMode (use model_duel or rules_duel)"
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

# Persist expanded contestants into run KICKOFF for late-join / auditors
$expandedPath = Join-Path $runDir "ARMS-EXPANDED.yaml"
$exp = @("run_mode: $runMode", "contestants:")
foreach ($c in $contestants) {
  $exp += "  - arm_id: $($c.arm_id)"
  $exp += "    model: $($c.model)"
  $exp += "    family: $($c.family)"
  $exp += "    pack_id: $($c.pack_id)"
  $exp += "    web_port: $($c.web_port)"
  $exp += "    db_port: $($c.db_port)"
  $exp += "    rules:"
  foreach ($r in $c.rules) { $exp += "      - $r" }
}
Set-Content -Path $expandedPath -Value ($exp -join "`n") -Encoding utf8

$ledger = Join-Path $runDir "results\COST-LEDGER.csv"
$header = "timestamp_utc,run_id,test,arm_id,phase,role,model,agent_id,kind,input_w_cache_write,input_wo_cache,cache_read,output_tokens,total_tokens,cost_usd,notes"
Set-Content -Path $ledger -Encoding utf8 -Value $header

$mapLines = @(
  "# Mapping - do not commit until FINAL-REPORT",
  "run_mode: $runMode",
  "reviewer: $reviewerModel ($reviewerFamily)"
)
foreach ($c in $contestants) {
  $rk = Rules-Key $c.rules
  $mapLines += "$($c.arm_id): model=$($c.model) family=$($c.family) pack=$($c.pack_id) rules=[$rk]"
}
Set-Content -Path (Join-Path $runDir ".scratch\mapping.md") -Value ($mapLines -join "`n") -Encoding utf8

$sourceMd = @"
# Source codebase (Test 1 only)

Path: ``$source``

Builders must NOT receive this path after Test 1.
"@
Set-Content -Path (Join-Path $runDir "SOURCE.md") -Value $sourceMd -Encoding utf8

foreach ($c in $contestants) {
  $armRoot = Join-Path $runDir "arms\$($c.arm_id)"
  $ws = Join-Path $armRoot "workspace"
  $rulesDir = Join-Path $armRoot ".cursor\rules"
  New-Item -ItemType Directory -Force -Path $ws, $rulesDir | Out-Null

  foreach ($rid in $c.rules) {
    $srcRule = Join-Path $catalogRules "$rid.mdc"
    if (-not (Test-Path $srcRule)) {
      throw "Rule file missing for id '$rid' (expected catalog/rules/$rid.mdc)"
    }
    Copy-Item $srcRule $rulesDir -Force
  }

  $ruleList = $c.rules -join ", "
  $armMd = @"
# Arm $($c.arm_id)

- run_mode: $runMode
- pack_id: $($c.pack_id)
- model: (see .scratch/mapping.md)
- web_port: $($c.web_port)
- db_port: $($c.db_port)
- rules: $ruleList
- workspace: ``workspace/``
- Do not run git. Do not touch ``../../results``.
"@
  Set-Content -Path (Join-Path $armRoot "ARM.md") -Value $armMd -Encoding utf8
  Copy-Item (Join-Path $templateArm "AGENTS.md") (Join-Path $armRoot "AGENTS.md") -Force
  Copy-Item (Join-Path $templateArm "CONTESTANT-PROMPT.md") (Join-Path $armRoot "CONTESTANT-PROMPT.md") -Force
}

$armIds = ($contestants | ForEach-Object { $_.arm_id }) -join ", "
$packSummary = ($contestants | ForEach-Object { "$($_.arm_id)=$($_.pack_id)" }) -join "; "
$rulesNote = if ($runMode -eq "rules_duel") { " and ``protocol/RULES-DUEL.md``" } else { "" }
$runReadme = @"
# Run ``$runId``

| Item | Value |
|---|---|
| Mode | ``$runMode`` |
| Source | ``$source`` |
| Reviewer | ``$reviewerModel`` ($reviewerFamily) |
| Arms | $armIds |
| Packs | $packSummary |

See ``protocol/EXPERIMENT-PLAN.md``$rulesNote.
"@
Set-Content -Path (Join-Path $runDir "README.md") -Value $runReadme -Encoding utf8

Write-Output "Bootstrapped $runDir"
Write-Output "run_mode=$runMode"
Write-Output "Arms: $armIds"
Write-Output "Packs: $packSummary"
Write-Output "Reviewer family OK: $reviewerFamily"
