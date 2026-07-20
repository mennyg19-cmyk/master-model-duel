# Detect which agent host is running this duel.
# Prints key=value lines (and optional JSON with -Json).
# Exit 0 always unless -Strict and confidence is low.
param(
  [switch]$Json,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"
$evidence = [System.Collections.Generic.List[string]]::new()
$scores = @{
  cursor   = 0
  opencode = 0
  generic  = 0
}

if ($env:DUEL_HOST) {
  $forced = $env:DUEL_HOST.Trim().ToLowerInvariant()
  if (@("cursor", "opencode", "generic") -contains $forced) {
    $evidence.Add("DUEL_HOST=$forced")
    $hostId = $forced
    $confidence = "high"
    $spawn = switch ($forced) {
      "cursor" { "cursor_task" }
      "opencode" { "opencode_cli" }
      default { "manual" }
    }
    if ($Json) {
      @{ host = $hostId; confidence = $confidence; spawn = $spawn; evidence = @($evidence) } | ConvertTo-Json -Compress
    }
    else {
      Write-Output "host=$hostId"
      Write-Output "confidence=$confidence"
      Write-Output "spawn=$spawn"
      Write-Output ("evidence=" + ($evidence -join "; "))
    }
    exit 0
  }
}

# Cursor signals
$cursorEnvKeys = @(
  "CURSOR_TRACE_ID", "CURSOR_AGENT", "CURSOR_SESSION_ID",
  "COMPOSER_SESSION", "CURSOR_EXTENSION_HOST"
)
foreach ($k in $cursorEnvKeys) {
  if (Get-Item "env:$k" -ErrorAction SilentlyContinue) {
    $scores.cursor += 3
    $evidence.Add("env:$k")
  }
}
if ($env:TERM_PROGRAM -match "vscode|cursor") {
  $scores.cursor += 1
  $evidence.Add("TERM_PROGRAM=$($env:TERM_PROGRAM)")
}
if (Get-Command cursor -ErrorAction SilentlyContinue) {
  $scores.cursor += 1
  $evidence.Add("cli:cursor")
}
if (Get-Command cursor-agent -ErrorAction SilentlyContinue) {
  $scores.cursor += 2
  $evidence.Add("cli:cursor-agent")
}

# OpenCode signals
if (Get-Command opencode -ErrorAction SilentlyContinue) {
  $scores.opencode += 3
  $evidence.Add("cli:opencode")
}
if ($env:OPENCODE_SERVER -or $env:OPENCODE_CONFIG -or $env:OPENCODE_DISABLE_CLAUDE_CODE) {
  $scores.opencode += 2
  $evidence.Add("env:OPENCODE_*")
}
$root = Split-Path $PSScriptRoot -Parent
if (Test-Path (Join-Path $root "opencode.json")) {
  $scores.opencode += 1
  $evidence.Add("repo:opencode.json")
}

# Weak: this repo always has .cursor/ — only tiny weight
if (Test-Path (Join-Path $root ".cursor\rules")) {
  $scores.cursor += 0.5
  $evidence.Add("repo:.cursor/rules")
}

# Pick winner
$ordered = $scores.GetEnumerator() | Sort-Object Value -Descending
$best = $ordered[0]
$second = $ordered[1]
$hostId = $best.Key
$bestScore = [double]$best.Value
$secondScore = [double]$second.Value

if ($bestScore -lt 1) {
  $hostId = "generic"
  $confidence = "low"
  $evidence.Add("fallback:generic")
}
elseif ($bestScore - $secondScore -lt 1.5) {
  $confidence = "low"
  $evidence.Add("ambiguous:cursor=$($scores.cursor);opencode=$($scores.opencode)")
}
elseif ($bestScore -ge 3) {
  $confidence = "high"
}
else {
  $confidence = "medium"
}

$spawn = switch ($hostId) {
  "cursor" { "cursor_task" }
  "opencode" { "opencode_cli" }
  default { "manual" }
}

if ($Strict -and $confidence -eq "low") {
  Write-Error "Host detection confidence low. Set DUEL_HOST=cursor|opencode|generic or answer kickoff Q-1."
  exit 1
}

if ($Json) {
  @{
    host       = $hostId
    confidence = $confidence
    spawn      = $spawn
    scores     = $scores
    evidence   = @($evidence)
  } | ConvertTo-Json -Compress
}
else {
  Write-Output "host=$hostId"
  Write-Output "confidence=$confidence"
  Write-Output "spawn=$spawn"
  Write-Output ("evidence=" + ($evidence -join "; "))
}
