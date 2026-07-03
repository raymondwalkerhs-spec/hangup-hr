# Publish a GitHub release from win-unpacked (patch zip = changed files only).
# Does NOT upload installer EXEs unless -IncludeInstaller is passed.
#
# Typical flow on your PC:
#   .\scripts\build.ps1 all
#   .\scripts\publish-github-release.ps1
#
# First GitHub update release (no previous manifest on GitHub):
#   .\scripts\publish-github-release.ps1 -IncludeFull
#
# Also ship Setup + Portable on GitHub (large, slow - usually unnecessary):
#   .\scripts\publish-github-release.ps1 -IncludeInstaller
param(
  [string]$Tag = "",
  [string]$Notes = "",
  [switch]$Draft,
  [switch]$IncludeFull,
  [switch]$IncludeInstaller,
  [switch]$Recreate
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

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

Write-Host "Fetching previous release manifest (for patch diff)..." -ForegroundColor Cyan
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
node scripts/fetch-release-manifest.js --tag=$version 2>&1 | Write-Host
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

if ($IncludeInstaller) {
  Get-ChildItem $dist -Filter "*Setup*.exe" -ErrorAction SilentlyContinue |
    Where-Object { Test-VersionAsset $_.Name } |
    ForEach-Object { $uploads.Add($_.FullName) }
  Get-ChildItem $dist -Filter "*.dmg" -ErrorAction SilentlyContinue |
    Where-Object { Test-VersionAsset $_.Name } |
    ForEach-Object { $uploads.Add($_.FullName) }
}

if (-not $patchZips.Count -and -not $fullZips.Count) {
  Write-Host "No patch or full zip created." -ForegroundColor Yellow
  Write-Host "  First GitHub update? Re-run with -IncludeFull" -ForegroundColor Yellow
  Write-Host "  Or ensure the previous release has win-x64-latest.json uploaded." -ForegroundColor Yellow
  if (-not $IncludeInstaller) { exit 1 }
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
  & gh release view $Tag 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $releaseExists = $true }
  $ErrorActionPreference = $prevEap
}

if ($Recreate) {
  Write-Host "Recreate: removing existing release/tag $Tag if present..." -ForegroundColor Yellow
  $ErrorActionPreference = "Continue"
  & gh release delete $Tag -y 2>$null | Out-Null
  $ErrorActionPreference = $prevEap
  $releaseExists = $false
}

if ($releaseExists) {
  Write-Host "Release $Tag exists - uploading with --clobber..." -ForegroundColor Cyan
  & gh release upload $Tag $uploads.ToArray() --clobber
} else {
  $ghArgs = @("release", "create", $Tag, "--title", "Hangup HR $version", "--notes", $Notes)
  if ($Draft) { $ghArgs = @("release", "create", $Tag, "--draft", "--title", "Hangup HR $version", "--notes", $Notes) }
  $ghArgs += $uploads.ToArray()
  Write-Host "Creating GitHub release $Tag..." -ForegroundColor Cyan
  & gh @ghArgs
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. In-app updater uses patch zip from win-unpacked (not EXEs)." -ForegroundColor Green
