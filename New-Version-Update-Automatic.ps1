#!/usr/bin/env pwsh
# Hangup Portal — New Version Release Tool
# Builds NSIS installer, publishes to GitHub, updates database, marks as latest.

$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────
function Write-Step  { param([string]$msg) Write-Host "`n  ── $msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$msg) Write-Host "  $msg" -ForegroundColor Green }
function Write-Fail  { param([string]$msg) Write-Host "  $msg" -ForegroundColor Red; pause; exit 1 }
function Write-Info  { param([string]$msg) Write-Host "  $msg" -ForegroundColor Yellow }

# Strip UTF-8 BOM from a file if present (protects app-builder.exe)
function Ensure-NoBOM {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        [System.IO.File]::WriteAllBytes($Path, $bytes[3..($bytes.Length - 1)])
        Write-Ok "Stripped BOM from $Path"
    }
}

# ── Header ───────────────────────────────────────────────────────────
$Host.UI.RawUI.WindowTitle = "Hangup Portal — New Version Release"
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   Hangup Portal — New Version Release Tool"    -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""

# ── Prompt ───────────────────────────────────────────────────────────
$NewVersion = Read-Host "  Enter new version (e.g. 1.8.2)"
if ([string]::IsNullOrWhiteSpace($NewVersion)) {
    Write-Fail "Version cannot be empty."
}

Write-Host ""
Write-Info "Version: $NewVersion"
$confirm = Read-Host "  Confirm? (Y/N)"
if ($confirm -notin @("Y", "y")) {
    Write-Host "  Cancelled." -ForegroundColor Yellow
    exit 0
}

# ── Step 1: Bump version ─────────────────────────────────────────────
Write-Step "Step 1/5: Bumping version in package.json"

$pkgPath = Join-Path $PSScriptRoot "package.json"
Ensure-NoBOM -Path $pkgPath

$pkgText = [System.IO.File]::ReadAllText($pkgPath, [System.Text.Encoding]::UTF8)
$pkg = $pkgText | ConvertFrom-Json
$pkg.version = $NewVersion
# Write back WITHOUT BOM
$jsonOut = ($pkg | ConvertTo-Json -Depth 100) + "`n"
[System.IO.File]::WriteAllText($pkgPath, $jsonOut, (New-Object System.Text.UTF8Encoding $false))
Write-Ok "Version set to $NewVersion"

# ── Step 2: Build NSIS ───────────────────────────────────────────────
Write-Step "Step 2/5: Building NSIS installer"

Ensure-NoBOM -Path $pkgPath   # safety strip before build
$env:SKIP_NATIVE_REBUILD = "1"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "scripts\build.ps1")
if ($LASTEXITCODE -ne 0) { Write-Fail "Build failed." }
Write-Ok "NSIS installer built successfully"

# ── Step 3: Publish GitHub release ───────────────────────────────────
Write-Step "Step 3/5: Publishing GitHub release"

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "scripts\publish-github-release.ps1") -IncludeFull
if ($LASTEXITCODE -ne 0) { Write-Fail "GitHub publish failed." }
Write-Ok "GitHub release published"

# ── Step 4: Update database ──────────────────────────────────────────
Write-Step "Step 4/5: Updating database version policy"

& node (Join-Path $PSScriptRoot "scripts\publish-app-version.js")
if ($LASTEXITCODE -ne 0) { Write-Fail "Database update failed." }
Write-Ok "Database updated — is_current = true"

# ── Step 5: Mark latest ──────────────────────────────────────────────
Write-Step "Step 5/5: Marking GitHub release as latest"

& gh release edit "v$NewVersion" --latest
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to mark release as latest." }
Write-Ok "Marked as latest"

# ── Done ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   DONE — v$NewVersion is LIVE"               -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  GitHub release: https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v$NewVersion"
Write-Host "  Database:       is_current = true"
Write-Host "  Installer:      dist\Hangup-Portal-Setup-$NewVersion.exe"
Write-Host ""
pause
