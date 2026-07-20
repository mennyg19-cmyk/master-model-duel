# List source codebase options for kickoff Q1 (GitHub/GitLab when logged in).
# Usage:
#   powershell -File scripts/list-source-options.ps1 [-Limit 30] [-Offset 0]
# Exit 0 when listing succeeds; auth github:no gitlab:no means freeform path/URL only.

param(
  [int]$Limit = 30,
  [int]$Offset = 0
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

function Test-GhAuth {
  try {
    $out = & gh auth status 2>&1 | Out-String
    return ($out -match "Logged in to github\.com")
  } catch {
    return $false
  }
}

function Test-GlabAuth {
  if (-not (Get-Command glab -ErrorAction SilentlyContinue)) { return $false }
  try {
    $out = & glab auth status 2>&1 | Out-String
    return ($LASTEXITCODE -eq 0 -and $out -notmatch "not logged in")
  } catch {
    return $false
  }
}

$ghOk = Test-GhAuth
$glabOk = Test-GlabAuth
$authBits = @()
if ($ghOk) { $authBits += "github:yes" } else { $authBits += "github:no" }
if ($glabOk) { $authBits += "gitlab:yes" } else { $authBits += "gitlab:no" }

Write-Output ("auth=" + ($authBits -join " "))
Write-Output "instruction=AskQuestion single-select over numbered rows, or fallback: reply with a number / owner/repo / local path / git URL."
Write-Output "escape=L=local path (type next)  U=git URL (type next)  M=more repos (raise -Offset)"
Write-Output ""

$i = 1 + $Offset
$shown = 0

if ($ghOk) {
  $fetch = [Math]::Min(100, $Offset + $Limit)
  $json = & gh repo list --limit $fetch --json nameWithOwner,description,isPrivate,url,updatedAt 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Output "error=gh repo list failed: $json"
  } else {
    $repos = $json | ConvertFrom-Json
    $slice = @($repos | Select-Object -Skip $Offset -First $Limit)
    foreach ($r in $slice) {
      $vis = if ($r.isPrivate) { "private" } else { "public" }
      $desc = if ($r.description) {
        $d = [string]$r.description
        if ($d.Length -gt 60) { $d.Substring(0, 57) + "..." } else { $d }
      } else { "" }
      $label = if ($desc) {
        "{0} ({1}) - {2}" -f $r.nameWithOwner, $vis, $desc
      } else {
        "{0} ({1})" -f $r.nameWithOwner, $vis
      }
      Write-Output ("{0}`tgithub`t{1}`t{2}`t{3}" -f $i, $r.nameWithOwner, $r.url, $label)
      $i++
      $shown++
    }
    if (@($repos).Count -ge ($Offset + $Limit)) {
      Write-Output "has_more=true"
    } else {
      Write-Output "has_more=false"
    }
  }
}

if ($glabOk) {
  $gjson = & glab repo list --mine -P $Limit -F json 2>&1
  if ($LASTEXITCODE -eq 0) {
    try {
      $grepos = $gjson | ConvertFrom-Json
      foreach ($r in @($grepos)) {
        $path = if ($r.path_with_namespace) { $r.path_with_namespace } elseif ($r.path) { $r.path } else { $r.name }
        $url = if ($r.http_url_to_repo) { $r.http_url_to_repo } elseif ($r.web_url) { $r.web_url } else { "" }
        $label = "gitlab: $path"
        Write-Output ("{0}`tgitlab`t{1}`t{2}`t{3}" -f $i, $path, $url, $label)
        $i++
        $shown++
      }
    } catch {
      Write-Output "error=glab parse failed"
    }
  }
}

Write-Output ("{0}`tlocal`tlocal`t`tLocal directory - I will type an absolute path" -f $i)
$i++
Write-Output ("{0}`turl`turl`t`tGit URL - I will paste a clone URL" -f $i)
$i++
if ($ghOk -or $glabOk) {
  Write-Output ("{0}`tmore`tmore`t`tShow more remote repos (next page)" -f $i)
}

Write-Output ""
Write-Output "count=$shown"
Write-Output "clone_hint=If remote picked and no local path yet: gh repo clone OWNER/REPO .scratch/sources/REPO (or glab repo clone). Record absolute path as source_codebase."
Write-Output "root=$root"
