@echo off
:: Launcher — delegates to the PowerShell release script
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-Version-Update-Automatic.ps1"
