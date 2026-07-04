# Hangup Portal - small bootstrap installer (downloads full Setup.exe or DMG from GitHub Releases).
# Usage:
#   .\scripts\install-from-github.ps1
#   .\scripts\install-from-github.ps1 -Version 1.3.9
#   .\scripts\install-from-github.ps1 -Repo owner/repo -Token ghp_...
param(
  [string]$Repo = "",
  [string]$Version = "",
  [string]$Token = "",
  [switch]$Silent
)

$ErrorActionPreference = "Stop"

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}

function Load-DotEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  Get-Content $Path -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $key = $matches[1].Trim()
      $val = $matches[2].Trim().Trim('"')
      if (-not [Environment]::GetEnvironmentVariable($key)) {
        Set-Item -Path "env:$key" -Value $val
      }
    }
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$cwd = (Get-Location).Path
foreach ($envPath in @(
  (Join-Path $root ".env"),
  (Join-Path $cwd ".env"),
  (Join-Path $scriptDir ".env")
)) {
  Load-DotEnv $envPath
}

if (-not $Repo) { $Repo = $env:GITHUB_UPDATES_REPO }
if (-not $Repo) { $Repo = "raymondwalkerhs-spec/hangup-hr" }
if (-not $Token) { $Token = $env:GITHUB_UPDATES_TOKEN }
if (-not $Token) { $Token = $env:GITHUB_TOKEN }

if (-not $Token) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($gh) {
    try {
      $Token = (& $gh.Source auth token 2>$null | Out-String).Trim()
    } catch {}
  }
}

function Get-GhHeaders {
  $h = @{
    "User-Agent"           = "Hangup-HR-Web-Installer"
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
  if ($Token) { $h.Authorization = "Bearer $Token" }
  return $h
}

function Get-GhDownloadHeaders {
  $h = @{
    "User-Agent" = "Hangup-HR-Web-Installer"
    Accept       = "application/octet-stream"
  }
  if ($Token) { $h.Authorization = "Bearer $Token" }
  return $h
}

function Fail-PrivateRepoHelp {
  Write-Host ""
  Write-Host "This GitHub repo is private. You need a token to download the installer." -ForegroundColor Yellow
  Write-Host "  1. Create a .env file next to Install-Hangup-HR.cmd with:" -ForegroundColor Yellow
  Write-Host "       GITHUB_UPDATES_REPO=$Repo" -ForegroundColor DarkGray
  Write-Host "       GITHUB_UPDATES_TOKEN=ghp_your_token" -ForegroundColor DarkGray
  Write-Host "  2. Or run: gh auth login   (GitHub CLI)" -ForegroundColor Yellow
  Write-Host "  3. Or pass: -Token ghp_..." -ForegroundColor Yellow
  Write-Host ""
}

function Parse-TagVersion {
  param([string]$Tag)
  $v = ($Tag -replace '^v', '').Trim()
  try { return [version]$v } catch { return [version]"0.0.0" }
}

function Get-ReleaseByVersion {
  param([string]$WantedVersion)
  $tag = if ($WantedVersion -match '^v') { $WantedVersion } else { "v$WantedVersion" }
  $uri = "https://api.github.com/repos/$Repo/releases/tags/$tag"
  return Invoke-RestMethod -Uri $uri -Headers (Get-GhHeaders) -Method Get
}

function Get-NewestRelease {
  $uri = "https://api.github.com/repos/$Repo/releases?per_page=30"
  try {
    $all = @(Invoke-RestMethod -Uri $uri -Headers (Get-GhHeaders) -Method Get)
  } catch {
    if ($_.Exception.Response.StatusCode -eq 404 -or -not $Token) {
      Fail-PrivateRepoHelp
    }
    throw
  }
  if (-not $all.Count) {
    if (-not $Token) { Fail-PrivateRepoHelp }
    throw "No releases returned for $Repo (check repo name and token)."
  }
  $candidates = @($all | Where-Object { -not $_.draft -and @($_.assets).Count -gt 0 })
  if (-not $candidates.Count) {
    throw "No published releases with downloadable assets found for $Repo"
  }
  return ($candidates | Sort-Object { Parse-TagVersion $_.tag_name } -Descending | Select-Object -First 1)
}

Write-Host ""
Write-Host "Hangup Portal - download installer from GitHub" -ForegroundColor Cyan
Write-Host "Repository: $Repo" -ForegroundColor DarkGray
if ($Token) {
  Write-Host "Auth: token loaded" -ForegroundColor DarkGray
} else {
  Write-Host "Auth: none (public repos only)" -ForegroundColor DarkGray
}
Write-Host ""

try {
  if ($Version) {
    $release = Get-ReleaseByVersion $Version
  } else {
    $release = Get-NewestRelease
  }
} catch {
  Write-Host "ERROR: Could not fetch release." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if (-not $Token) { Fail-PrivateRepoHelp }
  exit 1
}

$ver = ($release.tag_name -replace '^v', '').Trim()
Write-Host "Release: $($release.tag_name) ($ver)" -ForegroundColor Green

$assets = @($release.assets)
if (-not $assets.Count) {
  Write-Host "ERROR: Release has no assets." -ForegroundColor Red
  exit 1
}

$isMac = $false
if ($PSVersionTable.PSVersion.Major -ge 6) {
  $isMac = $IsMacOS
} elseif ($env:OS -eq "Darwin") {
  $isMac = $true
}

$asset = $null
if ($isMac) {
  $asset = $assets | Where-Object { $_.name -match '\.dmg$' -and $_.name -match [regex]::Escape($ver) } | Select-Object -First 1
  if (-not $asset) {
    $asset = $assets | Where-Object { $_.name -match '\.dmg$' } | Select-Object -First 1
  }
  if (-not $asset) {
    Write-Host "ERROR: No DMG found on release $($release.tag_name)." -ForegroundColor Red
    exit 1
  }
} else {
  $asset = $assets | Where-Object {
    $_.name -match 'Setup.*\.exe$' -and $_.name -notmatch 'uninstall|Web-Setup|Portable' -and $_.name -match [regex]::Escape($ver)
  } | Sort-Object {
    if ($_.name -match 'Portal-Setup') { 0 } elseif ($_.name -match 'HR-Beta') { 1 } else { 2 }
  } | Select-Object -First 1
  if (-not $asset) {
    $asset = $assets | Where-Object {
      $_.name -match 'Setup.*\.exe$' -and $_.name -notmatch 'uninstall|Web-Setup|Portable'
    } | Sort-Object {
      if ($_.name -match 'Portal-Setup') { 0 } elseif ($_.name -match 'HR-Beta') { 1 } else { 2 }
    } | Select-Object -First 1
  }
  if (-not $asset) {
    Write-Host "ERROR: No NSIS Setup.exe found on release $($release.tag_name)." -ForegroundColor Red
    Write-Host "Publish with: .\scripts\publish-github-release.ps1 -IncludeFull" -ForegroundColor Yellow
    exit 1
  }
}

$sizeMb = [math]::Round($asset.size / 1MB, 1)
Write-Host ("Download: {0} ({1} MB)" -f $asset.name, $sizeMb) -ForegroundColor Cyan

$destDir = Join-Path $env:TEMP "hangup-hr-install"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir $asset.name

$downloadUrl = "https://api.github.com/repos/$Repo/releases/assets/$($asset.id)"
$dlHeaders = Get-GhDownloadHeaders

Write-Host "Downloading to $dest ..." -ForegroundColor DarkGray
try {
  $ProgressPreference = "Continue"
  Invoke-WebRequest -Uri $downloadUrl -Headers $dlHeaders -OutFile $dest -UseBasicParsing
} catch {
  Write-Host ("ERROR: Download failed - {0}" -f $_.Exception.Message) -ForegroundColor Red
  if (-not $Token) { Fail-PrivateRepoHelp }
  exit 1
}

if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 1024) {
  Write-Host "ERROR: Downloaded file is missing or too small." -ForegroundColor Red
  exit 1
}

Write-Host "Download complete." -ForegroundColor Green

if ($isMac) {
  Write-Host "Opening DMG - drag Hangup Portal to Applications." -ForegroundColor Cyan
  Start-Process -FilePath "open" -ArgumentList @($dest)
  exit 0
}

Write-Host "Launching installer..." -ForegroundColor Cyan
$setupArgs = @()
if ($Silent) { $setupArgs += "/S" }

$p = Start-Process -FilePath $dest -ArgumentList $setupArgs -PassThru -Wait
if ($p.ExitCode -and $p.ExitCode -ne 0) {
  Write-Host ("Installer exited with code {0}" -f $p.ExitCode) -ForegroundColor Yellow
} else {
  Write-Host "Done. Launch Hangup Portal from the Start menu or desktop shortcut." -ForegroundColor Green
}
