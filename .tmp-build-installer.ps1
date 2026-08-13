$env:SKIP_NATIVE_REBUILD = "1"
Set-Location "f:\download app hr"
& powershell -ExecutionPolicy Bypass -File "scripts\build.ps1" installer
