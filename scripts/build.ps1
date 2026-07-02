# Build Hangup HR - installer + portable (Windows x64)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Test-Path "credentials\service-account.json")) {
  if ($env:SKIP_CREDENTIALS_CHECK -eq "1" -or $env:CI -eq "true") {
    New-Item -ItemType Directory -Force -Path "credentials" | Out-Null
    '{}' | Set-Content "credentials\service-account.json"
    Write-Host "WARNING: Using stub service-account.json (CI / SKIP_CREDENTIALS_CHECK)." -ForegroundColor Yellow
  } else {
    Write-Host "ERROR: credentials\service-account.json is missing." -ForegroundColor Red
    Write-Host "Copy the Google service account key before building."
    exit 1
  }
}

if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Write-Host "WARNING: .env missing - packaged .env.example for the installer." -ForegroundColor Yellow
  } else {
    Write-Host "ERROR: .env is missing and no .env.example found." -ForegroundColor Red
    exit 1
  }
}

function Stop-HangupAppProcesses {
  $names = @("Hangup HR", "Hangup HR Beta", "electron")
  $stopped = $false
  foreach ($name in $names) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    if ($procs) {
      Write-Host "Closing running $name process(es) before build..." -ForegroundColor Yellow
      $procs | Stop-Process -Force -ErrorAction SilentlyContinue
      $stopped = $true
    }
  }
  if ($stopped) { Start-Sleep -Seconds 2 }
}

function Clear-UnpackedOutput {
  param([string]$OutputDir = "dist")

  $unpacked = Join-Path $PWD "$OutputDir\win-unpacked"
  if (-not (Test-Path $unpacked)) { return $OutputDir }

  Write-Host "Clearing $OutputDir\win-unpacked..." -ForegroundColor Cyan
  try {
    Remove-Item -LiteralPath $unpacked -Recurse -Force -ErrorAction Stop
    return $OutputDir
  } catch {
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $bakName = "win-unpacked.bak-$stamp"
    try {
      Rename-Item -LiteralPath $unpacked -NewName $bakName -ErrorAction Stop
      Write-Host "Renamed locked folder to $OutputDir\$bakName" -ForegroundColor Yellow
      return $OutputDir
    } catch {
      $alt = "dist-build"
      Write-Host "WARNING: $OutputDir\win-unpacked is locked (close Hangup HR, File Explorer in dist\, and retry)." -ForegroundColor Yellow
      Write-Host "         Building into $alt\ instead." -ForegroundColor Yellow
      return $alt
    }
  }
}

Stop-HangupAppProcesses

$betaArgs = @($args | Where-Object { $_ -eq "beta" })
$channel = if ($betaArgs.Count -gt 0) { $betaArgs[0] } else { $null }
$outputDir = "dist"
if ($channel -eq "beta") {
  Write-Host "Building beta channel (version from package.json, output: ${outputDir}\)" -ForegroundColor Magenta
}

$buildOutput = Clear-UnpackedOutput -OutputDir $outputDir
$env:HR_BUILD_OUTPUT = $buildOutput

if ($env:CI -eq "true" -and (Test-Path "node_modules")) {
  Write-Host "CI: using dependencies from workflow (skip npm install)" -ForegroundColor Cyan
} else {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($env:CI -eq "true") {
  Write-Host "CI: native modules already rebuilt in workflow" -ForegroundColor Cyan
} else {
  Write-Host "Rebuilding native modules for Electron..." -ForegroundColor Cyan
  npm run rebuild:native
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Code signing: electron-builder signs automatically when a certificate is
# provided via env vars. Set CSC_LINK (path to .pfx/.p12) and CSC_KEY_PASSWORD
# before running this script to produce a signed executable.
if ($env:CSC_LINK) {
  Write-Host "Code signing: certificate detected (CSC_LINK) - build will be signed." -ForegroundColor Green
} else {
  Write-Host "Code signing: no certificate set (CSC_LINK) - build will be UNSIGNED." -ForegroundColor Yellow
  Write-Host "  To sign: set CSC_LINK to your .pfx path and CSC_KEY_PASSWORD, then rebuild." -ForegroundColor DarkGray
}

$target = $args[0]
if (-not $target) { $target = "all" }

$builderArgs = @("--config.directories.output=$buildOutput")
if ($env:CI -eq "true") {
  $builderArgs += "--publish"
  $builderArgs += "never"
}
switch ($target) {
  "installer" { npx electron-builder --win nsis @builderArgs }
  "portable"  { npx electron-builder --win portable @builderArgs }
  default     { npx electron-builder --win nsis portable @builderArgs }
}

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Build complete. Output in ${buildOutput}\:" -ForegroundColor Green
Get-ChildItem $buildOutput -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('  ' + $_.Name) }
