# Publish a release to GitHub after a LOCAL build (installer workflow unchanged).
# Requires: gh CLI logged in, tag already matches package.json version.
#
# Typical flow on your PC:
#   .\scripts\build.ps1 all
#   npm run package:github -- --full
#   .\scripts\publish-github-release.ps1
#
# Or with a explicit tag:
#   .\scripts\publish-github-release.ps1 -Tag v1.0.9-beta.1 -Notes "Bug fixes"
param(
  [string]$Tag = "",
  [string]$Notes = "",
  [switch]$Draft
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = $pkg.version
if (-not $Tag) { $Tag = "v$version" }
if ($Tag -notmatch "^v") { $Tag = "v$Tag" }

$dist = if ($env:HR_BUILD_OUTPUT) { $env:HR_BUILD_OUTPUT } else { "dist" }
if (-not (Test-Path $dist)) {
  Write-Host "ERROR: $dist not found. Run .\scripts\build.ps1 first." -ForegroundColor Red
  exit 1
}

# Only upload assets for the current package.json version (skip stale EXEs from prior builds).
function Test-VersionAsset {
  param([string]$Name)
  return $Name -match [regex]::Escape($version)
}

$zips = Get-ChildItem $dist -Filter "Hangup-HR-*.zip" -ErrorAction SilentlyContinue |
  Where-Object { Test-VersionAsset $_.Name }
$exes = Get-ChildItem $dist -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { Test-VersionAsset $_.Name }
$manifests = Get-ChildItem "$dist\update-manifests" -Filter "*-latest.json" -ErrorAction SilentlyContinue

$skipped = @(
  Get-ChildItem $dist -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { -not (Test-VersionAsset $_.Name) }
  Get-ChildItem $dist -Filter "Hangup-HR-*.zip" -ErrorAction SilentlyContinue | Where-Object { -not (Test-VersionAsset $_.Name) }
)
if ($skipped.Count) {
  Write-Host "Skipping $($skipped.Count) stale asset(s) not matching v$version" -ForegroundColor DarkGray
}

if (-not $zips -and -not $exes) {
  Write-Host "No release assets for v$version in $dist. Run:" -ForegroundColor Yellow
  Write-Host "  .\scripts\build.ps1 all"
  Write-Host "  npm run package:github -- --full"
  exit 1
}

$uploads = @()
$uploads += $zips | ForEach-Object { $_.FullName }
$uploads += $exes | ForEach-Object { $_.FullName }
$uploads += $manifests | ForEach-Object { $_.FullName }

if (-not $Notes) {
  $Notes = "Hangup HR $version - see CHANGELOG.md"
}

$releaseExists = $false
& gh release view $Tag 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $releaseExists = $true }

if ($releaseExists) {
  Write-Host "Release $Tag exists - uploading $($uploads.Count) asset(s) with --clobber..." -ForegroundColor Cyan
  & gh release upload $Tag $uploads --clobber
} else {
  $ghArgs = @("release", "create", $Tag, "--title", "Hangup HR $version", "--notes", $Notes)
  if ($Draft) { $ghArgs = @("release", "create", $Tag, "--draft", "--title", "Hangup HR $version", "--notes", $Notes) }
  $ghArgs += $uploads
  Write-Host "Creating GitHub release $Tag with $($uploads.Count) asset(s)..." -ForegroundColor Cyan
  & gh @ghArgs
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Set GITHUB_UPDATES_REPO in packaged .env to your owner/repo slug." -ForegroundColor Green
