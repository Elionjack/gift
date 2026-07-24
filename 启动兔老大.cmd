@echo off
chcp 65001 >nul
title Rabbit Pet Local Server
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Please copy the error above and send it to me.
  pause
)
