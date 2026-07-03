# Publish a GitHub release from win-unpacked + NSIS Setup.exe (required for in-app updates).
#
# Typical flow on your PC:
#   .\scripts\build.ps1 all
#   .\scripts\publish-github-release.ps1 -IncludeFull
#
# First GitHub update release (no previous manifest on GitHub):
#   .\scripts\publish-github-release.ps1 -IncludeFull
#
# Also ship Portable + DMG on GitHub (optional):
#   .\scripts\publish-github-release.ps1 -IncludeFull -IncludeExtras
param(
  [string]$Tag = "",
  [string]$Notes = "",
  [switch]$Draft,
  [switch]$IncludeFull,
  [switch]$IncludeExtras,
  [switch]$IncludeInstaller,
  [switch]$Recreate
)

if ($IncludeInstaller -and -not $IncludeExtras) {
  $IncludeExtras = $true
}

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$ghExe = $null
$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if ($ghCmd) {
  $ghExe = $ghCmd.Source
} else {
  foreach ($candidate in @(
    "${env:ProgramFiles}\GitHub CLI\gh.exe",
    "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe"
  )) {
    if (Test-Path $candidate) { $ghExe = $candidate; break }
  }
}
if (-not $ghExe) {
  Write-Host "ERROR: GitHub CLI (gh) not found. Install from https://cli.github.com/ or add gh to PATH." -ForegroundColor Red
  exit 1
}

# Load .env for GITHUB_UPDATES_REPO / tokens (used by manifest fetch).
if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $key = $matches[1].Trim()
      $val = $matches[2].Trim().Trim('"')
      if (-not [Environment]::GetEnvironmentVariable($key)) {
        Set-Item -Path "env:$key" -Value $val
      }
    }
  }
}

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = $pkg.version
if (-not $Tag) { $Tag = "v$version" }
if ($Tag -notmatch "^v") { $Tag = "v$Tag" }

$dist = if ($env:HR_BUILD_OUTPUT) { $env:HR_BUILD_OUTPUT } else { "dist" }
if (-not (Test-Path $dist)) {
  Write-Host "ERROR: $dist not found. Run .\scripts\build.ps1 first." -ForegroundColor Red
  exit 1
}

$unpacked = Join-Path $dist "win-unpacked"
if (-not (Test-Path $unpacked)) {
  Write-Host "ERROR: $unpacked not found. Run .\scripts\build.ps1 first (needs win-unpacked)." -ForegroundColor Red
  exit 1
}

$env:HR_BUILD_OUTPUT = (Resolve-Path $dist).Path

Write-Host "Fetching previous release manifests (for patch diff)..." -ForegroundColor Cyan
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
node scripts/fetch-all-release-manifests.js 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) {
  node scripts/fetch-release-manifest.js --tag=$version 2>&1 | Write-Host
}
$ErrorActionPreference = $prevEap

Write-Host "Packaging win-unpacked for v$version..." -ForegroundColor Cyan
$packageArgs = @("scripts/package-github-release.js")
if ($IncludeFull) { $packageArgs += "--full" }
$ErrorActionPreference = "Continue"
node @packageArgs 2>&1 | Write-Host
$ErrorActionPreference = $prevEap
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# If no patch was produced, auto-build full zip once.
$patchZips = @(Get-ChildItem $dist -Filter "Hangup-HR-*-patch-*.zip" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match [regex]::Escape($version) })
$fullZips = @(Get-ChildItem $dist -Filter "Hangup-HR-*-full.zip" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match [regex]::Escape($version) })
if (-not $patchZips.Count -and -not $fullZips.Count -and -not $IncludeFull) {
  Write-Host "No patch zip - building full win-unpacked zip for this release..." -ForegroundColor Yellow
  $ErrorActionPreference = "Continue"
  node scripts/package-github-release.js --full 2>&1 | Write-Host
  $ErrorActionPreference = $prevEap
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Test-VersionAsset {
  param([string]$Name)
  return $Name -match [regex]::Escape($version)
}

$uploads = [System.Collections.Generic.List[string]]::new()

$patchZips = @(Get-ChildItem $dist -Filter "Hangup-HR-*-patch-*.zip" -ErrorAction SilentlyContinue |
  Where-Object { Test-VersionAsset $_.Name })
$fullZips = @(Get-ChildItem $dist -Filter "Hangup-HR-*-full.zip" -ErrorAction SilentlyContinue |
  Where-Object { Test-VersionAsset $_.Name })

foreach ($z in $patchZips) { $uploads.Add($z.FullName) }
foreach ($z in $fullZips) { $uploads.Add($z.FullName) }

$manifestDir = Join-Path $dist "update-manifests"
if (Test-Path $manifestDir) {
  Get-ChildItem $manifestDir -Filter "*-latest.json" -ErrorAction SilentlyContinue |
    ForEach-Object { $uploads.Add($_.FullName) }
}

$setupExes = @(Get-ChildItem $dist -Filter "*Setup*.exe" -ErrorAction SilentlyContinue |
  Where-Object { Test-VersionAsset $_.Name })
foreach ($s in $setupExes) { $uploads.Add($s.FullName) }

if (-not $setupExes.Count) {
  Write-Host "WARNING: No *Setup*.exe for v$version in $dist - NSIS in-app updates will fail." -ForegroundColor Yellow
  Write-Host "  Run .\scripts\build.ps1 all or installer first." -ForegroundColor Yellow
}

if ($IncludeExtras) {
  Get-ChildItem $dist -Filter "*Portable*.exe" -ErrorAction SilentlyContinue |
    Where-Object { Test-VersionAsset $_.Name } |
    ForEach-Object { $uploads.Add($_.FullName) }
  Get-ChildItem $dist -Filter "*.dmg" -ErrorAction SilentlyContinue |
    Where-Object { Test-VersionAsset $_.Name } |
    ForEach-Object { $uploads.Add($_.FullName) }
}

if (-not $patchZips.Count -and -not $fullZips.Count -and -not $setupExes.Count) {
  Write-Host "No patch, full zip, or Setup.exe created." -ForegroundColor Yellow
  Write-Host "  First GitHub update? Re-run with -IncludeFull" -ForegroundColor Yellow
  Write-Host "  Or ensure the previous release has win-x64-latest.json uploaded." -ForegroundColor Yellow
  exit 1
}

if (-not $uploads.Count) {
  Write-Host "Nothing to upload." -ForegroundColor Red
  exit 1
}

$totalMb = ($uploads | ForEach-Object { (Get-Item $_).Length } | Measure-Object -Sum).Sum / 1MB
Write-Host "Uploading $($uploads.Count) asset(s), $([math]::Round($totalMb, 1)) MB total:" -ForegroundColor Cyan
foreach ($u in $uploads) { Write-Host "  $(Split-Path $u -Leaf)" -ForegroundColor DarkGray }

if (-not $Notes) {
  $Notes = "Hangup HR $version - see CHANGELOG.md"
}

$releaseExists = $false
if (-not $Recreate) {
  $ErrorActionPreference = "Continue"
  & $ghExe release view $Tag 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $releaseExists = $true }
  $ErrorActionPreference = $prevEap
}

if ($Recreate) {
  Write-Host "Recreate: removing existing release/tag $Tag if present..." -ForegroundColor Yellow
  $ErrorActionPreference = "Continue"
  & $ghExe release delete $Tag -y 2>$null | Out-Null
  $ErrorActionPreference = $prevEap
  $releaseExists = $false
}

if ($releaseExists) {
  Write-Host "Release $Tag exists - uploading with --clobber..." -ForegroundColor Cyan
  & $ghExe release upload $Tag $uploads.ToArray() --clobber
} else {
  $ghArgs = @("release", "create", $Tag, "--title", "Hangup HR $version", "--notes", $Notes)
  if ($Draft) { $ghArgs = @("release", "create", $Tag, "--draft", "--title", "Hangup HR $version", "--notes", $Notes) }
  $ghArgs += $uploads.ToArray()
  Write-Host "Creating GitHub release $Tag..." -ForegroundColor Cyan
  & $ghExe @ghArgs
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Done. In-app updater uses Setup.exe (NSIS) + full zips (portable/mac).' -ForegroundColor Green
