$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Write-Host "WARNING: .env missing - packaged .env.example for the installer." -ForegroundColor Yellow
  } else {
    Write-Host "ERROR: .env is missing and no .env.example found." -ForegroundColor Red
    exit 1
  }
}

$stopped = $false
foreach ($name in @("Hangup Backup", "electron")) {
  $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
  if ($procs) {
    Write-Host "Closing running $name process(es)..." -ForegroundColor Yellow
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    $stopped = $true
  }
}
if ($stopped) { Start-Sleep -Seconds 2 }

$outputDir = "dist-backup"
if (-not (Test-Path "$outputDir\win-unpacked")) {
  # clean slate — use dist-backup
} elseif ($env:CI -eq "true") {
  try { Remove-Item -LiteralPath "$outputDir\win-unpacked" -Recurse -Force -ErrorAction Stop } catch {}
} else {
  # Previous build leftovers may be locked; use a fresh dir to avoid ENOENT
  $outputDir = "dist-backup-build"
}
if (Test-Path "$outputDir\win-unpacked") {
  try { Remove-Item -LiteralPath "$outputDir\win-unpacked" -Recurse -Force -ErrorAction Stop } catch {}
}

if ($env:CI -eq "true" -and (Test-Path "node_modules")) {
  Write-Host "CI: using existing dependencies" -ForegroundColor Cyan
} else {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($env:CSC_LINK) {
  Write-Host "Code signing: certificate detected (CSC_LINK)" -ForegroundColor Green
} else {
  Write-Host "Code signing: no certificate set (CSC_LINK) - build will be UNSIGNED." -ForegroundColor Yellow
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$pkgPath = Join-Path $PWD "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$origMain = $pkg.main
$pkg.main = "electron/backup-main.js"
[System.IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 10), $utf8NoBom)

try {
  $builderArgs = @(
    "--config.appId=com.hangup.hr.backup"
    "--config.productName=Hangup Backup"
    "--config.directories.output=$outputDir"
    "--config.win.artifactName=Hangup-Backup-Setup-`${version}.`${ext}"
    "--config.nsis.oneClick=false"
    "--config.nsis.allowToChangeInstallationDirectory=true"
    "--config.nsis.createDesktopShortcut=true"
    "--config.nsis.createStartMenuShortcut=true"
    "--config.nsis.shortcutName=Hangup Backup"
    "--config.nsis.uninstallDisplayName=Hangup Backup"
    "--config.npmRebuild=false"
    "--config.forceCodeSigning=false"
    "--config.afterPack=scripts/electron-after-pack.js"
  )
  if ($env:CI -eq "true") {
    $builderArgs += "--publish"
    $builderArgs += "never"
  }

  & "node_modules\.bin\electron-builder.cmd" --win nsis @builderArgs
} finally {
  $pkg.main = $origMain
  [System.IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 10), $utf8NoBom)
  Write-Host "Restored package.json main to $origMain" -ForegroundColor DarkGray
}

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Backup app build complete. Output in ${outputDir}\:" -ForegroundColor Green
Get-ChildItem $outputDir -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('  ' + $_.Name) }
