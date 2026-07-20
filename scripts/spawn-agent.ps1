# Spawn one contestant/reviewer agent using the detected (or given) host.
# OpenCode: runs `opencode run` non-interactively.
# Cursor: writes a Task brief the orchestrator must execute (cannot shell-spawn Cursor Task).
# Generic: writes a manual spawn brief.
param(
  [Parameter(Mandatory = $true)]
  [string]$ArmDir,
  [Parameter(Mandatory = $true)]
  [string]$Model,
  [Parameter(Mandatory = $true)]
  [string]$PromptFile,
  [string]$Role = "contestant",
  [ValidateSet("cursor", "opencode", "generic", "auto")]
  [string]$DuelHost = "auto",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

if ($DuelHost -eq "auto") {
  $detect = & (Join-Path $PSScriptRoot "detect-host.ps1")
  foreach ($line in $detect) {
    if ($line -match "^host=(.+)$") { $DuelHost = $Matches[1] }
  }
}

if (-not (Test-Path $ArmDir)) { throw "ArmDir not found: $ArmDir" }
if (-not (Test-Path $PromptFile)) { throw "PromptFile not found: $PromptFile" }

$promptText = Get-Content $PromptFile -Raw
$scratch = Join-Path $ArmDir ".scratch"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$filledPath = Join-Path $scratch "spawn-$Role-$stamp.md"
Set-Content -Path $filledPath -Value $promptText -Encoding utf8

$logLine = "host=$DuelHost role=$Role model=$Model arm=$ArmDir prompt=$filledPath"

switch ($DuelHost) {
  "opencode" {
    if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
      throw "OpenCode CLI not on PATH. Install opencode or set DUEL_HOST / -DuelHost."
    }
    $cmd = "opencode run --model `"$Model`" --file `"$filledPath`" `"Read AGENTS.md and rules/, then execute the attached spawn prompt file fully. Working directory is this arm folder.`""
    Write-Output "SPAWN_MODE=opencode_cli"
    Write-Output "WORKDIR=$ArmDir"
    Write-Output "COMMAND=$cmd"
    if ($DryRun) { exit 0 }
    Push-Location $ArmDir
    try {
      # Prefer modern flags; fall back if older CLI
      & opencode run --model $Model --file $filledPath "Read AGENTS.md and rules/, then execute the attached spawn prompt fully."
      if ($LASTEXITCODE -ne 0) {
        & opencode -p (Get-Content $filledPath -Raw) -q
      }
    }
    finally {
      Pop-Location
    }
  }
  "cursor" {
    $brief = @"
# Cursor Task spawn (orchestrator must run this)

The shell cannot start Cursor Task agents. In **this** Cursor chat, spawn a Task/subagent:

- **model:** ``$Model``
- **cwd / focus:** ``$ArmDir``
- **prompt file:** ``$filledPath``
- **role:** $Role

Instructions for the subagent: open ``$filledPath``, obey arm ``AGENTS.md`` / ``.cursor/rules``, do not touch other arms.
"@
    $briefPath = Join-Path $scratch "CURSOR-TASK-$Role-$stamp.md"
    Set-Content -Path $briefPath -Value $brief -Encoding utf8
    Write-Output "SPAWN_MODE=cursor_task"
    Write-Output "BRIEF=$briefPath"
    Write-Output "MODEL=$Model"
    Write-Output "ARM=$ArmDir"
    Write-Output $logLine
    if ($DryRun) { exit 0 }
    Write-Output "ACTION_REQUIRED: Orchestrator — spawn Task now using BRIEF above."
    exit 2
  }
  default {
    $brief = @"
# Manual spawn

1. Open your multi-model tool.
2. Working directory: ``$ArmDir``
3. Model: ``$Model``
4. Paste contents of: ``$filledPath``
"@
    $briefPath = Join-Path $scratch "MANUAL-SPAWN-$Role-$stamp.md"
    Set-Content -Path $briefPath -Value $brief -Encoding utf8
    Write-Output "SPAWN_MODE=manual"
    Write-Output "BRIEF=$briefPath"
    Write-Output $logLine
    exit 2
  }
}
