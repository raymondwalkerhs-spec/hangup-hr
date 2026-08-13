# Release Workflow Script for Hangup Portal
# Provides 3-step release process: Start Test, Build, Post Update

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hangup Portal Release Workflow v$version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Show-Menu {
  Write-Host "Select an action:" -ForegroundColor Yellow
  Write-Host "  1. Start Test (run dev server)" -ForegroundColor White
  Write-Host "  2. Build (NSIS installer + update patch)" -ForegroundColor White
  Write-Host "  3. Post Update (ship to GitHub + mark latest)" -ForegroundColor White
  Write-Host "  4. Exit" -ForegroundColor White
  Write-Host ""
}

function Start-DevServer {
  Write-Host "Starting development server..." -ForegroundColor Green
  npm start
}

function Build-Release {
  Write-Host "Building NSIS installer and update patches..." -ForegroundColor Green
  .\scripts\build.ps1 all
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    return
  }
  Write-Host ""
  Write-Host "Build complete. Now run 'npm run package:github -- --full' to create GitHub packages." -ForegroundColor Yellow
  Write-Host "Then run 'npm run verify:update -- dist\Hangup-Portal-$version-win-x64-full.zip' to verify." -ForegroundColor Yellow
}

function Post-Update {
  Write-Host "Posting update for local build..." -ForegroundColor Green
  
  Write-Host "Step 1: Updating app_versions in Supabase..." -ForegroundColor Cyan
  node scripts/publish-app-version.js --notes "v$version local release"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to update app_versions!" -ForegroundColor Red
    return
  }
  
  Write-Host ""
  Write-Host "Step 2: Rebuilding web installer..." -ForegroundColor Cyan
  npm run dist:web-installer
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Web installer build failed (non-critical)!" -ForegroundColor Yellow
  }
  
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Green
  Write-Host "  Local release v$version posted successfully!" -ForegroundColor Green
  Write-Host "========================================" -ForegroundColor Green
  Write-Host ""
  Write-Host "Installer location: dist\Hangup-Portal-Setup-$version.exe" -ForegroundColor Yellow
}

while ($true) {
  Show-Menu
  $choice = Read-Host "Enter choice (1-4)"
  
  switch ($choice) {
    "1" {
      Start-DevServer
    }
    "2" {
      Build-Release
    }
    "3" {
      Post-Update
    }
    "4" {
      Write-Host "Exiting..." -ForegroundColor Yellow
      exit 0
    }
    default {
      Write-Host "Invalid choice. Please enter 1-4." -ForegroundColor Red
    }
  }
  
  Write-Host ""
  Write-Host "Press any key to continue..." -ForegroundColor Gray
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
  Clear-Host
}
