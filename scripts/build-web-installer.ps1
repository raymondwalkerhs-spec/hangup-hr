# Build Hangup-Portal-Web-Setup.exe - small GUI installer with embedded GitHub token.
# Reads GITHUB_UPDATES_TOKEN + GITHUB_UPDATES_REPO from .env at build time only.
param(
  [string]$Version = "",
  [string]$OutputDir = "dist-bootstrap"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

function Load-DotEnvLocal {
  if (-not (Test-Path ".env")) { return }
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $key = $matches[1].Trim()
      $val = $matches[2].Trim().Trim('"')
      if (-not [Environment]::GetEnvironmentVariable($key)) {
        Set-Item -Path "env:$key" -Value $val
      }
    }
  }
}

function Find-Csc {
  foreach ($c in @(
    "${env:WINDIR}\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "${env:WINDIR}\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

function Escape-CSharpString {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  return ($Value -replace '\\', '\\\\' -replace '"', '\"')
}

Load-DotEnvLocal

$repo = if ($env:GITHUB_UPDATES_REPO) { $env:GITHUB_UPDATES_REPO.Trim() } else { "raymondwalkerhs-spec/hangup-hr" }
$token = $env:GITHUB_UPDATES_TOKEN
if (-not $token) { $token = $env:GITHUB_TOKEN }
if (-not $token) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($gh) {
    try { $token = (& $gh.Source auth token 2>$null | Out-String).Trim() } catch {}
  }
}
if (-not $token) {
  Write-Host "ERROR: GITHUB_UPDATES_TOKEN required in .env (or gh auth login)." -ForegroundColor Red
  exit 1
}

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
# Default: no pin — EXE always resolves the newest full Setup from GitHub at run time.
# Pass -Version 1.3.10 only when you need to test a specific release.
$pinVersion = ""
if ($PSBoundParameters.ContainsKey("Version") -and $Version) {
  $pinVersion = $Version
} elseif (-not $PSBoundParameters.ContainsKey("Version")) {
  Write-Host "Pin: none (downloads latest Setup from GitHub at run time)" -ForegroundColor DarkGray
}

$srcDir = Join-Path $PSScriptRoot "web-installer"
$srcFile = Join-Path $srcDir "WebInstaller.cs"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$workDir = Join-Path $OutputDir "web-installer-build"
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$workCs = Join-Path $workDir "WebInstaller.cs"

$cs = Get-Content $srcFile -Raw
$cs = $cs.Replace("WEB_INSTALLER_GITHUB_REPO", (Escape-CSharpString $repo))
$cs = $cs.Replace("WEB_INSTALLER_GITHUB_TOKEN", (Escape-CSharpString $token))
$cs = $cs.Replace("WEB_INSTALLER_PIN_VERSION", (Escape-CSharpString $pinVersion))
Set-Content -Path $workCs -Value $cs -Encoding UTF8

$csc = Find-Csc
if (-not $csc) {
  Write-Host "ERROR: csc.exe not found (.NET Framework)." -ForegroundColor Red
  exit 1
}

$outExe = Join-Path $OutputDir "Hangup-Portal-Web-Setup.exe"

$pinLabel = if ($pinVersion) { $pinVersion } else { "latest" }
Write-Host "Compiling web installer (repo: $repo, pin: $pinLabel)..." -ForegroundColor Cyan
& $csc /nologo /target:winexe /optimize+ `
  "/out:$outExe" `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /reference:System.Web.Extensions.dll `
  $workCs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$sizeKb = [math]::Round((Get-Item $outExe).Length / 1KB, 1)
Write-Host ""
Write-Host "Built: $outExe ($sizeKb KB)" -ForegroundColor Green
Write-Host "GitHub token is embedded in the EXE (private repo downloads work)." -ForegroundColor DarkGray
Write-Host "Do not publish this EXE to a public website - distribute via USB / internal share only." -ForegroundColor Yellow
