# Build Hangup Portal - NSIS installer (Windows x64). Use "portable" arg only for legacy portable builds.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$supabaseBackend = $false
if (Test-Path ".env") {
  $envContent = Get-Content ".env" -Raw -ErrorAction SilentlyContinue
  if ($envContent -match '(?m)^\s*DATA_BACKEND\s*=\s*supabase\s*$') {
    $supabaseBackend = $true
  }
}

if (-not (Test-Path "credentials\service-account.json")) {
  if ($supabaseBackend -or $env:SKIP_CREDENTIALS_CHECK -eq "1" -or $env:CI -eq "true") {
    New-Item -ItemType Directory -Force -Path "credentials" | Out-Null
    '{}' | Set-Content "credentials\service-account.json"
    if ($supabaseBackend) {
      Write-Host "WARNING: Using stub service-account.json (DATA_BACKEND=supabase)." -ForegroundColor Yellow
    } else {
      Write-Host "WARNING: Using stub service-account.json (CI / SKIP_CREDENTIALS_CHECK)." -ForegroundColor Yellow
    }
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

if ($env:HR_RELEASE_BUILD -eq "1") {
  $sessionSecret = ""
  if (Test-Path ".env") {
    $m = Select-String -Path ".env" -Pattern '^\s*SESSION_SECRET\s*=\s*(.+)\s*$' | Select-Object -First 1
    if ($m) { $sessionSecret = $m.Matches.Groups[1].Value.Trim().Trim('"').Trim("'") }
  }
  $weak = @("", "hangup-hr-desktop-secret", "hangup-backup-secret")
  if ($weak -contains $sessionSecret) {
    Write-Host "ERROR: SESSION_SECRET must be set to a strong random value in .env for release builds (HR_RELEASE_BUILD=1)." -ForegroundColor Red
    exit 1
  }
}

function Stop-HangupAppProcesses {
  $names = @("Hangup Portal", "Hangup HR", "Hangup HR Beta", "electron")
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
      foreach ($alt in @("dist-build2", "dist-beta7", "dist-release")) {
        $altUnpacked = Join-Path $PWD "$alt\win-unpacked"
        try {
          if (Test-Path $altUnpacked) {
            Remove-Item -LiteralPath $altUnpacked -Recurse -Force -ErrorAction Stop
          }
          Write-Host "Building into $alt\ (previous output locked)." -ForegroundColor Yellow
          return $alt
        } catch {
          continue
        }
      }
      $alt = "dist-build"
      Write-Host "WARNING: $OutputDir\win-unpacked is locked (close Hangup Portal, File Explorer in dist\, and retry)." -ForegroundColor Yellow
      Write-Host "         Building into $alt\ instead." -ForegroundColor Yellow
      return $alt
    }
  }
}

function Get-SafeBuilderVersion {
  param([string]$version)
  if (-not $version) { return $null }
  if ($version -match '^[0-9]+\.[0-9]+\.[0-9]+$') { return $version }
  if ($version -match '^([0-9]+\.[0-9]+\.[0-9]+)(?:[.-].*)$') { return $matches[1] }
  return $null
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
} elseif ($env:SKIP_NATIVE_REBUILD -eq "1") {
  Write-Host "SKIP_NATIVE_REBUILD=1 - skipping electron-rebuild (use prebuilt native modules)" -ForegroundColor Yellow
} else {
  if (-not $env:npm_config_msvs_version) {
    $env:npm_config_msvs_version = "2022"
    Write-Host "Using npm_config_msvs_version=2022 for native rebuild (VS 18 may be unsupported)" -ForegroundColor DarkGray
  }
  Write-Host "Rebuilding native modules for Electron..." -ForegroundColor Cyan
  npm run rebuild:native
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$pkgPath = Join-Path $PWD "package.json"
$packageJson = Get-Content $pkgPath -Raw | ConvertFrom-Json
$originalVersion = $packageJson.version
$builderVersion = Get-SafeBuilderVersion $originalVersion
$tempPackageCreated = $false
$backupPackagePath = Join-Path $PWD "package.json.build.bak"
$tempPackagePath = Join-Path $PWD "package.json.build.tmp"
if ($builderVersion -and $builderVersion -ne $originalVersion) {
  Write-Host "Using builder-compatible version $builderVersion for packaging. Preserving actual version $originalVersion via build.extraMetadata." -ForegroundColor Yellow
  Copy-Item -Path $pkgPath -Destination $backupPackagePath -Force
  $packageJson.version = $builderVersion
  if (-not $packageJson.build) { $packageJson.build = @{} }
  if (-not $packageJson.build.extraMetadata) { $packageJson.build.extraMetadata = @{} }
  $packageJson.build.extraMetadata.version = $originalVersion
  $packageJson | ConvertTo-Json -Depth 20 | Set-Content -Path $tempPackagePath -Encoding UTF8
  Copy-Item -Path $tempPackagePath -Destination $pkgPath -Force
  $tempPackageCreated = $true
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
if ($env:SKIP_NATIVE_REBUILD -eq "1") {
  $builderArgs += "--config.npmRebuild=false"
}
if ($env:CI -eq "true") {
  $builderArgs += "--publish"
  $builderArgs += "never"
} elseif ($env:SKIP_NATIVE_REBUILD -eq "1") {
  $builderArgs += "--publish"
  $builderArgs += "never"
}
try {
  switch ($target) {
    "portable"  { npx electron-builder --win portable @builderArgs }
    default     { npx electron-builder --win nsis @builderArgs }
  }

  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  if ($tempPackageCreated) {
    Write-Host "Restoring original package.json after packaging..." -ForegroundColor Cyan
    Copy-Item -Path $backupPackagePath -Destination $pkgPath -Force
    Remove-Item -Path $backupPackagePath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $tempPackagePath -Force -ErrorAction SilentlyContinue
  }
}

# Remove stale EXEs from this output folder so future publishes stay fast.
Get-ChildItem $buildOutput -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch [regex]::Escape((Get-Content package.json -Raw | ConvertFrom-Json).version) } |
  ForEach-Object {
    Write-Host "Pruning stale $($_.Name)" -ForegroundColor DarkGray
    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    $bm = "$($_.FullName).blockmap"
    if (Test-Path $bm) { Remove-Item $bm -Force -ErrorAction SilentlyContinue }
  }

Write-Host ""
Write-Host "Build complete. Output in ${buildOutput}\:" -ForegroundColor Green
Get-ChildItem $buildOutput -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('  ' + $_.Name) }
