@echo off
title Hangup Portal - Install from GitHub
cd /d "%~dp0"
if not exist "%~dp0scripts\install-from-github.ps1" (
  echo ERROR: scripts\install-from-github.ps1 not found.
  echo Unzip the full Hangup-Portal-Web-Installer folder, then run this file again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-from-github.ps1" %*
if errorlevel 1 (
  echo.
  echo Install failed. Press any key to close.
  pause >nul
  exit /b 1
)
pause
