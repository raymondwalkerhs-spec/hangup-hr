# Copy root app into hr-app/ for GitHub macOS CI (build-macos.yml uses working-directory: hr-app).
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root "hr-app"
$exclude = @("node_modules", "dist", "dist-build", "hr-app", "macos-artifact", "macos-artifact-new", "macos-artifact-latest", "macos-v109", "macos-v109b2", ".git")

if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest | Out-Null

Get-ChildItem -LiteralPath $root -Force | Where-Object {
  $exclude -notcontains $_.Name
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dest $_.Name) -Recurse -Force
}

Write-Host "Synced to hr-app/ (version $((Get-Content (Join-Path $dest 'package.json') | ConvertFrom-Json).version))"
