# Resolve kickoff source_codebase from a local path, owner/repo, or git URL.
# Usage examples:
#   powershell -File scripts/resolve-source.ps1 -LocalPath "D:\Projects\App"
#   powershell -File scripts/resolve-source.ps1 -OwnerRepo "owner/name"
#   powershell -File scripts/resolve-source.ps1 -GitUrl "https://github.com/owner/name.git"
# Prints: source_codebase=<absolute path>

param(
  [string]$LocalPath = "",
  [string]$OwnerRepo = "",
  [string]$GitUrl = "",
  [string]$CloneRoot = ""
)

$ErrorActionPreference = "Stop"
$harnessRoot = Split-Path $PSScriptRoot -Parent
if (-not $CloneRoot) {
  $CloneRoot = Join-Path $harnessRoot ".scratch\sources"
}

function Emit-Source([string]$path) {
  $full = [System.IO.Path]::GetFullPath($path)
  if (-not (Test-Path $full)) { throw "Path does not exist: $full" }
  Write-Output "source_codebase=$full"
}

if ($LocalPath) {
  Emit-Source $LocalPath
  exit 0
}

if ($GitUrl -and -not $OwnerRepo) {
  if ($GitUrl -match 'github\.com[:/]([^/]+)/([^/.]+)') {
    $OwnerRepo = "$($Matches[1])/$($Matches[2])"
  } elseif ($GitUrl -match 'gitlab\.com[:/](.+?)(?:\.git)?$') {
    $OwnerRepo = $Matches[1].TrimEnd('/')
  } else {
    throw "Could not parse owner/repo from GitUrl. Pass -OwnerRepo or -LocalPath."
  }
}

if (-not $OwnerRepo) {
  throw "Provide -LocalPath, -OwnerRepo, or -GitUrl."
}

$repoName = ($OwnerRepo -split '/')[-1]
$dest = Join-Path $CloneRoot $repoName

if (Test-Path $dest) {
  Emit-Source $dest
  exit 0
}

New-Item -ItemType Directory -Force -Path $CloneRoot | Out-Null

if (Get-Command gh -ErrorAction SilentlyContinue) {
  $auth = & gh auth status 2>&1 | Out-String
  if ($auth -match "Logged in to github\.com") {
    & gh repo clone $OwnerRepo $dest
    if ($LASTEXITCODE -ne 0) { throw "gh repo clone failed for $OwnerRepo" }
    Emit-Source $dest
    exit 0
  }
}

if ((Get-Command glab -ErrorAction SilentlyContinue) -and ($OwnerRepo -match '/')) {
  & glab repo clone $OwnerRepo $dest
  if ($LASTEXITCODE -ne 0) { throw "glab repo clone failed for $OwnerRepo" }
  Emit-Source $dest
  exit 0
}

if ($GitUrl) {
  & git clone $GitUrl $dest
  if ($LASTEXITCODE -ne 0) { throw "git clone failed for $GitUrl" }
  Emit-Source $dest
  exit 0
}

throw "Not logged in to gh/glab and no -GitUrl. Clone manually or pass -LocalPath."
