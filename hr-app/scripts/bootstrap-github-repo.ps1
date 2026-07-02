# Initialize git repo and print next steps for GitHub Releases.
# Does NOT push — you create the repo on github.com and add secrets first.
param(
  [string]$RemoteUrl = ""
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

function Find-Git {
  $candidates = @(
    "git",
    "C:\Program Files\Git\bin\git.exe",
    "C:\Program Files (x86)\Git\bin\git.exe"
  )
  foreach ($c in $candidates) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { return $c }
    if (Test-Path $c) { return $c }
  }
  return $null
}

$git = Find-Git
if (-not $git) {
  Write-Host "ERROR: git not found. Install Git for Windows: https://git-scm.com/download/win" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".git")) {
  Write-Host "Initializing git repository..." -ForegroundColor Cyan
  & $git init
  & $git add .
  & $git commit -m "Hangup HR — initial commit"
  Write-Host "Created initial commit." -ForegroundColor Green
} else {
  Write-Host "Git repo already exists." -ForegroundColor Yellow
  & $git status -sb
}

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = $pkg.version
$tag = "v$version"

Write-Host ""
Write-Host "=== Next steps (manual) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Create empty repo on GitHub (e.g. hangup-hr)"
Write-Host "2. Add Actions secrets: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY, SESSION_SECRET"
Write-Host "   See .github\RELEASE_SETUP.md"
Write-Host ""
if ($RemoteUrl) {
  Write-Host "3. Add remote and push:"
  Write-Host "   $git remote add origin $RemoteUrl"
  Write-Host "   $git branch -M main"
  Write-Host "   $git push -u origin main"
} else {
  Write-Host "3. Add remote and push:"
  Write-Host "   $git remote add origin https://github.com/YOUR-ORG/hangup-hr.git"
  Write-Host "   $git branch -M main"
  Write-Host "   $git push -u origin main"
}
Write-Host ""
Write-Host "4. Set in .env (then rebuild installer once):"
Write-Host "   GITHUB_UPDATES_REPO=YOUR-ORG/hangup-hr"
Write-Host ""
Write-Host "5. Publish first release (full zips bootstrap):"
Write-Host "   $git tag $tag"
Write-Host "   $git push origin $tag"
Write-Host "   (triggers .github\workflows\release.yml)"
Write-Host ""
Write-Host "Or locally after build: npm run publish:github" -ForegroundColor DarkGray
