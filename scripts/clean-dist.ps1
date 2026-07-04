# Remove stale build outputs; keep only the current package.json version.
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = $pkg.version
$keepSetup = "*Setup-$version.exe"

$dirs = @("dist", "dist-build2", "dist-beta7", "dist-release")
foreach ($d in $dirs) {
  if (-not (Test-Path $d)) { continue }
  Write-Host "Cleaning $d (keep $keepSetup)..." -ForegroundColor Cyan

  Get-ChildItem $d -File -ErrorAction SilentlyContinue | ForEach-Object {
    $name = $_.Name
    $remove = $false
    if ($name -match '^Hangup-(HR|Portal)-.+\.(zip|blockmap)$') { $remove = $name -notmatch [regex]::Escape($version) }
    elseif ($name -match '^Hangup-(HR-Beta.*Setup|Portal-Setup).+\.exe$') { $remove = $name -notmatch [regex]::Escape($version) }
    elseif ($name -match '^\.patch-staging') { $remove = $true }
    if ($remove) {
      if ($DryRun) { Write-Host "  would remove $name" }
      else { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    }
  }

  Get-ChildItem $d -Directory -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '^\.patch-staging' -or $_.Name -match '^win-unpacked\.bak'
  } | ForEach-Object {
    if ($DryRun) { Write-Host "  would remove dir $($_.Name)" }
    else { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

Write-Host "Done. Current version: $version" -ForegroundColor Green
