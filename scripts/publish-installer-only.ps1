# Fast ship: NSIS Setup.exe + web installer + win-x64 manifest only (~100 MB upload).
#   .\scripts\build.ps1 installer
#   npm run dist:web-installer
#   .\scripts\publish-installer-only.ps1
param(
  [string]$Tag = "",
  [string]$Notes = "",
  [switch]$Recreate
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
$ghExe = $null
if ($ghCmd) { $ghExe = $ghCmd.Source }
if (-not $ghExe) {
  foreach ($candidate in @(
    "${env:ProgramFiles}\GitHub CLI\gh.exe",
    "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe"
  )) {
    if (Test-Path $candidate) { $ghExe = $candidate; break }
  }
}
if (-not $ghExe) { throw "GitHub CLI (gh) not found" }

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = $pkg.version
if (-not $Tag) { $Tag = "v$version" }
if ($Tag -notmatch "^v") { $Tag = "v$Tag" }

$dist = if ($env:HR_BUILD_OUTPUT) { $env:HR_BUILD_OUTPUT } else { "dist" }
$setup = Get-ChildItem $dist -Filter "*Setup-$version.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup) {
  $setup = Get-ChildItem $dist -Filter "Hangup-Portal-Setup-$version.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $setup) { throw "No Setup-$version.exe in $dist — run .\scripts\build.ps1 installer" }

$webSetup = Join-Path "dist-bootstrap" "Hangup-Portal-Web-Setup.exe"
if (-not (Test-Path $webSetup)) {
  Write-Host "Building web installer..." -ForegroundColor Yellow
  npm run dist:web-installer | Write-Host
}

$manifestDir = Join-Path $dist "update-manifests"
$winManifest = Join-Path $manifestDir "win-x64-latest.json"
if (-not (Test-Path $winManifest)) {
  $unpacked = Join-Path $dist "win-unpacked"
  if (-not (Test-Path $unpacked)) { throw "Need win-unpacked for manifest — run .\scripts\build.ps1 installer" }
  $env:HR_BUILD_OUTPUT = (Resolve-Path $dist).Path
  node scripts/package-github-release.js 2>&1 | Write-Host
}

$uploads = @($setup.FullName)
if (Test-Path $winManifest) { $uploads += (Resolve-Path $winManifest).Path }
if (Test-Path $webSetup) { $uploads += (Resolve-Path $webSetup).Path }

if (-not $Notes) { $Notes = "Hangup Portal $version — see CHANGELOG.md" }

$mb = ($uploads | ForEach-Object { (Get-Item $_).Length } | Measure-Object -Sum).Sum / 1MB
Write-Host "Installer-only upload ($([math]::Round($mb,1)) MB):" -ForegroundColor Cyan
foreach ($u in $uploads) { Write-Host "  $(Split-Path $u -Leaf)" -ForegroundColor DarkGray }

if ($Recreate) {
  & $ghExe release delete $Tag -y 2>$null | Out-Null
}

$exists = $false
$ErrorActionPreference = "Continue"
& $ghExe release view $Tag 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $exists = $true }
$ErrorActionPreference = "Stop"

if ($exists) {
  & $ghExe release upload $Tag $uploads --clobber
} else {
  & $ghExe release create $Tag --title "Hangup Portal $version" --notes $Notes $uploads
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $ghExe release edit $Tag --latest --prerelease=false
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running publish-app-version.js..." -ForegroundColor Cyan
node scripts/publish-app-version.js
Write-Host "Done — $Tag is Latest on GitHub." -ForegroundColor Green
