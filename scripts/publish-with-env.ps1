<#
Load key env vars from .env and run publish-installer-only.ps1.
This sets GITHUB_TOKEN from GITHUB_UPDATES_TOKEN and exports Supabase keys.
#>
Param()

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

if (-not (Test-Path .env)) {
  Write-Host ".env not found; aborting." -ForegroundColor Red
  exit 1
}

Get-Content .env | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq '' -or $line.StartsWith('#')) { return }
  $parts = $line -split '=', 2
  if ($parts.Count -ne 2) { return }
  $name = $parts[0].Trim()
  $val = $parts[1].Trim()
  # Remove surrounding quotes if present
  if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Trim('"') }
  if ($val.StartsWith("'" ) -and $val.EndsWith("'")) { $val = $val.Trim("'") }
  # Map repo-specific token name to standard GITHUB_TOKEN for gh CLI
  if ($name -eq 'GITHUB_UPDATES_TOKEN') {
    $env:GITHUB_TOKEN = $val
    $env:GITHUB_UPDATES_TOKEN = $val
  } else {
    $env:$name = $val
  }
}

Write-Host "Environment loaded from .env (sensitive values hidden)" -ForegroundColor Green
Write-Host "GITHUB_TOKEN: $(if ($env:GITHUB_TOKEN) { 'set' } else { 'NOT SET' })"
Write-Host "SUPABASE_SECRET_KEY: $(if ($env:SUPABASE_SECRET_KEY) { 'set' } else { 'NOT SET' })"

# Now run the publish script
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish-installer-only.ps1
