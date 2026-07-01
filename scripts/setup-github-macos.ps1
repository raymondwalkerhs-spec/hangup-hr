# One-time: push Hangup HR to GitHub and trigger macOS build.
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  Write-Host "Install GitHub CLI: winget install GitHub.cli" -ForegroundColor Red
  exit 1
}

$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Log in to GitHub (browser will open)..." -ForegroundColor Cyan
  gh auth login -h github.com -p https -w
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$credPath = Join-Path $Root "hr-app\credentials\service-account.json"
if (-not (Test-Path $credPath)) {
  Write-Host "Missing $credPath — copy service account key first." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".git")) {
  git init
  git branch -M main
}

git add -A
$status = git status --porcelain
if ($status) {
  git commit -m "Hangup HR desktop app with macOS GitHub Actions build"
}

$repoName = "hangup-hr"
$owner = (gh api user -q .login)
$fullName = "$owner/$repoName"

$exists = gh repo view $fullName 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating private repo $fullName ..." -ForegroundColor Cyan
  gh repo create $repoName --private --source=. --remote=origin --push
} else {
  git remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0) { git remote add origin "https://github.com/$fullName.git" }
  git push -u origin main
}

Write-Host "Setting SERVICE_ACCOUNT_JSON secret..." -ForegroundColor Cyan
Get-Content $credPath -Raw | gh secret set SERVICE_ACCOUNT_JSON

Write-Host "Starting macOS build workflow..." -ForegroundColor Cyan
gh workflow run "Build macOS"

Write-Host ""
Write-Host "Done. Watch progress:" -ForegroundColor Green
Write-Host "  gh run watch"
Write-Host "  gh run list --workflow=build-macos.yml"
Write-Host ""
Write-Host "When finished, download artifacts:" -ForegroundColor Green
Write-Host "  gh run download --name hangup-hr-macos -D hr-app/dist/macos"
