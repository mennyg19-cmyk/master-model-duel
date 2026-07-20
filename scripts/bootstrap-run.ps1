# Bootstrap an isolated duel run from KICKOFF.yaml
# Supports run_mode: model_duel | rules_duel
# Accepts either expanded contestants[] or rules_duel rule_packs[] (+ contestant_model).
param(
  [Parameter(Mandatory = $true)]
  [string]$KickoffYaml,
  [ValidateSet("cursor", "opencode", "generic")]
  [string]$DuelHost = "cursor"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Test-Path $KickoffYaml)) { throw "Kickoff not found: $KickoffYaml" }

$rawLines = Get-Content $KickoffYaml
$runId = $null
$runMode = "model_duel"
$hostFromYaml = $null
foreach ($line in $rawLines) {
  if ($line -match '^\s*run_id:\s*(.+)$') {
    $runId = $Matches[1].Trim().Trim('"').Trim("'")
  }
  if ($line -match '^\s*run_mode:\s*(.+)$') {
    $runMode = $Matches[1].Trim().Trim('"').Trim("'")
  }
  if ($line -match '^\s*host:\s*(.+)$') {
    $hostFromYaml = $Matches[1].Trim().Trim('"').Trim("'").ToLowerInvariant()
  }
}
if (-not $runId) { throw "KICKOFF.yaml missing run_id" }
if ($hostFromYaml) {
  if (@("cursor", "opencode", "generic") -notcontains $hostFromYaml) {
    throw "Unknown host in KICKOFF.yaml: $hostFromYaml"
  }
  $DuelHost = $hostFromYaml
}

$runDir = Join-Path $root "runs\$runId"
$catalogRules = Join-Path $root "catalog\rules"
$templateArm = Join-Path $root "template\arm"
$familiesPath = Join-Path $root "catalog\MODEL-FAMILIES.json"
$families = Get-Content $familiesPath -Raw | ConvertFrom-Json

function Get-FamilyId([string]$slug) {
  foreach ($prop in $families.families.PSObject.Properties) {
    $fam = $prop.Value
    $all = @()
    if ($fam.slugs) { $all += @($fam.slugs) }
    if ($fam.hosts) {
      foreach ($hp in $fam.hosts.PSObject.Properties) {
        if ($hp.Value) { $all += @($hp.Value) }
      }
    }
    if ($all -contains $slug) { return $prop.Name }
  }
  return $null
}

function Strip-MdcFrontmatter([string]$text) {
  if ($text -match '(?s)\A---\r?\n.*?\r?\n---\r?\n(.*)\z') {
    return $Matches[1].TrimStart()
  }
  return $text
}

function Write-ArmRules {
  param(
    [string]$ArmRoot,
    [string[]]$RuleIds,
    [string]$HostName
  )
  $plainDir = Join-Path $ArmRoot "rules"
  New-Item -ItemType Directory -Force -Path $plainDir | Out-Null
  $bodies = @()
  foreach ($rid in $RuleIds) {
    $srcRule = Join-Path $catalogRules "$rid.mdc"
    if (-not (Test-Path $srcRule)) {
      throw "Rule file missing for id '$rid' (expected catalog/rules/$rid.mdc)"
    }
    $raw = Get-Content $srcRule -Raw
    $body = Strip-MdcFrontmatter $raw
    Set-Content -Path (Join-Path $plainDir "$rid.md") -Value $body -Encoding utf8
    $bodies += "---`n# Rule: $rid`n`n$body"
    if ($HostName -eq "cursor") {
      $cursorDir = Join-Path $ArmRoot ".cursor\rules"
      New-Item -ItemType Directory -Force -Path $cursorDir | Out-Null
      Copy-Item $srcRule $cursorDir -Force
    }
  }
  if ($HostName -eq "opencode" -or $HostName -eq "generic") {
    $agentsExtra = @"

## Selected rule pack (also in rules/)

Read and follow every file in ``rules/``. Summary concatenated below for hosts that only load AGENTS.md.

$($bodies -join "`n`n")
"@
    $baseAgents = Get-Content (Join-Path $templateArm "AGENTS.md") -Raw
    Set-Content -Path (Join-Path $ArmRoot "AGENTS.md") -Value ($baseAgents.TrimEnd() + "`n" + $agentsExtra) -Encoding utf8
  }
  if ($HostName -eq "opencode") {
    $ocJson = @"
{
  "`$schema": "https://opencode.ai/config.json",
  "instructions": ["rules/*.md"]
}
"@
    Set-Content -Path (Join-Path $ArmRoot "opencode.json") -Value $ocJson -Encoding utf8
  }
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
$includeGrill = $true
$grillSeesCodebase = $false
$grillSeed = $null
$inventoryMode = "single"
$selfReviewMode = "single"
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
  if ($line -match '^\s*include_grill_inventory:\s*(.+)$') {
    $v = $Matches[1].Trim().Trim('"').Trim("'").ToLowerInvariant()
    $includeGrill = ($v -eq "true" -or $v -eq "yes" -or $v -eq "1")
    continue
  }
  if ($line -match '^\s*grill_sees_codebase_inventory:\s*(.+)$') {
    $v = $Matches[1].Trim().Trim('"').Trim("'").ToLowerInvariant()
    $grillSeesCodebase = ($v -eq "true" -or $v -eq "yes" -or $v -eq "1")
    continue
  }
  if ($line -match '^\s*grill_seed:\s*(.+)$') {
    $grillSeed = $Matches[1].Trim().Trim('"').Trim("'"); continue
  }
  if ($line -match '^\s*inventory_mode:\s*(.+)$') {
    $inventoryMode = $Matches[1].Trim().Trim('"').Trim("'"); continue
  }
  if ($line -match '^\s*self_review_mode:\s*(.+)$') {
    $selfReviewMode = $Matches[1].Trim().Trim('"').Trim("'"); continue
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
  (Join-Path $runDir "shared\phases"),
  (Join-Path $runDir "shared\smoke"),
  (Join-Path $runDir "results"),
  (Join-Path $runDir "results\reviews"),
  (Join-Path $runDir ".scratch"),
  (Join-Path $runDir "kit"),
  (Join-Path $runDir "arms")
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

Copy-Item $KickoffYaml (Join-Path $runDir "KICKOFF.yaml") -Force

# Frozen execution kit (prompts, rubrics, smoke, test6, orchestrator helpers)
$templateRoot = Join-Path $root "template"
foreach ($sub in @("prompts", "rubrics", "smoke", "test6", "orchestrator")) {
  $src = Join-Path $templateRoot $sub
  $dst = Join-Path $runDir "kit\$sub"
  if (Test-Path $src) {
    Copy-Item $src $dst -Recurse -Force
  }
}
Copy-Item (Join-Path $templateRoot "smoke\*") (Join-Path $runDir "shared\smoke\") -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $templateRoot "rubrics\SCOREBOARD.md") (Join-Path $runDir "results\SCOREBOARD.md") -Force
Copy-Item (Join-Path $templateRoot "rubrics\FINAL-REPORT.md") (Join-Path $runDir "results\FINAL-REPORT.md") -Force
$runStateSrc = Join-Path $templateRoot "orchestrator\RUN-STATE.template.md"
$runStateBody = (Get-Content $runStateSrc -Raw) -replace '__RUN_ID__', $runId
$runStateBody = $runStateBody -replace 'include_grill_inventory: true\|false', "include_grill_inventory: $includeGrill"
Set-Content -Path (Join-Path $runDir ".scratch\run-state.md") -Value $runStateBody -Encoding utf8
Copy-Item (Join-Path $templateRoot "orchestrator\SPAWN-CHECKLIST.md") (Join-Path $runDir ".scratch\SPAWN-CHECKLIST.md") -Force
Copy-Item (Join-Path $templateRoot "orchestrator\COST-LEDGER-HOWTO.md") (Join-Path $runDir "results\COST-LEDGER-HOWTO.md") -Force
Copy-Item (Join-Path $templateRoot "test6\BUG-LEDGER.template.md") (Join-Path $runDir ".scratch\BUG-LEDGER.template.md") -Force

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
  "host: $DuelHost",
  "run_mode: $runMode",
  "reviewer: $reviewerModel ($reviewerFamily)",
  "inventory_mode: $inventoryMode",
  "self_review_mode: $selfReviewMode",
  "include_grill_inventory: $includeGrill",
  "grill_sees_codebase_inventory: $grillSeesCodebase"
)
if ($grillSeed) { $mapLines += "grill_seed: $grillSeed" }
foreach ($c in $contestants) {
  $rk = Rules-Key $c.rules
  $mapLines += "$($c.arm_id): model=$($c.model) family=$($c.family) pack=$($c.pack_id) rules=[$rk]"
}
Set-Content -Path (Join-Path $runDir ".scratch\mapping.md") -Value ($mapLines -join "`n") -Encoding utf8

if ($grillSeed) {
  Set-Content -Path (Join-Path $runDir "shared\GRILL-SEED.md") -Value $grillSeed -Encoding utf8
}

$sourceMd = @"
# Source codebase (Test 1a only)

Path: ``$source``

Builders must NOT receive this path after Test 1a.
Grill agents: grill_sees_codebase_inventory=$grillSeesCodebase
"@
Set-Content -Path (Join-Path $runDir "SOURCE.md") -Value $sourceMd -Encoding utf8

foreach ($c in $contestants) {
  $armRoot = Join-Path $runDir "arms\$($c.arm_id)"
  $ws = Join-Path $armRoot "workspace"
  $armResults = Join-Path $armRoot "results"
  New-Item -ItemType Directory -Force -Path $ws, $armResults | Out-Null

  $ruleIds = @($c.rules)
  if ($includeGrill -and ($ruleIds -notcontains "grill-protocol")) {
    $ruleIds += "grill-protocol"
  }

  Write-ArmRules -ArmRoot $armRoot -RuleIds $ruleIds -HostName $DuelHost

  if ($DuelHost -eq "cursor") {
    Copy-Item (Join-Path $templateArm "AGENTS.md") (Join-Path $armRoot "AGENTS.md") -Force
  }

  $ruleList = $ruleIds -join ", "
  $armMd = @"
# Arm $($c.arm_id)

- host: $DuelHost
- run_mode: $runMode
- pack_id: $($c.pack_id)
- model: (see .scratch/mapping.md)
- web_port: $($c.web_port)
- db_port: $($c.db_port)
- rules: $ruleList
- inventory_mode: $inventoryMode
- self_review_mode: $selfReviewMode
- include_grill_inventory: $includeGrill
- workspace: ``workspace/``
- results: ``results/``
- Frozen prompts: ``../../kit/prompts/``
- Host guide: ``../../../adapters/$DuelHost/HOST.md``
- Do not run git. Do not touch ``../../results`` (run-level) except via orchestrator.
"@
  Set-Content -Path (Join-Path $armRoot "ARM.md") -Value $armMd -Encoding utf8
  Copy-Item (Join-Path $templateArm "CONTESTANT-PROMPT.md") (Join-Path $armRoot "CONTESTANT-PROMPT.md") -Force
}

$armIds = ($contestants | ForEach-Object { $_.arm_id }) -join ", "
$packSummary = ($contestants | ForEach-Object { "$($_.arm_id)=$($_.pack_id)" }) -join "; "
$rulesNote = if ($runMode -eq "rules_duel") { " and ``protocol/RULES-DUEL.md``" } else { "" }
$grillNote = if ($includeGrill) { "yes" } else { "no" }
$runReadme = @"
# Run ``$runId``

| Item | Value |
|---|---|
| Host | ``$DuelHost`` |
| Mode | ``$runMode`` |
| Source | ``$source`` |
| Reviewer | ``$reviewerModel`` ($reviewerFamily) |
| Arms | $armIds |
| Packs | $packSummary |
| Inventory mode | ``$inventoryMode`` |
| Self-review mode | ``$selfReviewMode`` |
| Grill inventory (1b) | $grillNote |

## Kit (frozen at bootstrap)

- Prompts: ``kit/prompts/``
- Rubrics: ``kit/rubrics/``
- Smoke templates: ``shared/smoke/`` + ``kit/smoke/``
- Orchestrator: ``.scratch/run-state.md``, ``.scratch/SPAWN-CHECKLIST.md``
- Scoreboard: ``results/SCOREBOARD.md``

See ``adapters/$DuelHost/HOST.md`` and ``protocol/EXPERIMENT-PLAN.md``$rulesNote. Grill: ``protocol/GRILL-INVENTORY.md``.
"@
Set-Content -Path (Join-Path $runDir "README.md") -Value $runReadme -Encoding utf8

Write-Output "Bootstrapped $runDir"
Write-Output "host=$DuelHost run_mode=$runMode"
Write-Output "Arms: $armIds"
Write-Output "Packs: $packSummary"
Write-Output "include_grill_inventory=$includeGrill inventory_mode=$inventoryMode self_review_mode=$selfReviewMode"
Write-Output "Kit copied to kit/ + shared/smoke/"
Write-Output "Reviewer family OK: $reviewerFamily"
