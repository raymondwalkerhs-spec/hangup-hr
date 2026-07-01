# Build Hangup HR — installer + portable (Windows x64)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Test-Path "credentials\service-account.json")) {
  Write-Host "ERROR: credentials\service-account.json is missing." -ForegroundColor Red
  Write-Host "Copy the Google service account key before building."
  exit 1
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Rebuilding native modules for Electron..." -ForegroundColor Cyan
npm run rebuild:native
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$target = $args[0]
if (-not $target) { $target = "all" }

switch ($target) {
  "installer" { npm run dist:installer }
  "portable"  { npm run dist:portable }
  default     { npm run dist:all }
}

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Build complete. Output in dist\:" -ForegroundColor Green
Get-ChildItem dist -Filter "*.exe" | ForEach-Object { Write-Host "  $($_.Name)" }
