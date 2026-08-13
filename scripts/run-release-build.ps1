Set-Location 'F:\download app hr'
$env:SKIP_NATIVE_REBUILD = '1'
$env:CI = 'true'
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\build.ps1 all
