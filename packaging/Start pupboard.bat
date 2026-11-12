@echo off
rem pupboard launcher for Windows: double-click to start.
rem Keep this window open while you use the dashboard; close it to stop.
setlocal
title pupboard
cd /d "%~dp0"
set "OPEN_BROWSER=1"
set "DEFAULT_HOST=127.0.0.1"
set "ENVFILE="
if exist ".env" set "ENVFILE=--env-file=.env"
"%~dp0runtime\node.exe" %ENVFILE% server\index.js
echo.
echo pupboard has stopped. Press any key to close this window.
pause >nul
