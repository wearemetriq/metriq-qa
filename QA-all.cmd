@echo off
rem Double-click: checks every client in the sites folder (live addresses) and opens one summary.
rem Drag a list file (one address per line) onto this file to check those addresses instead.
cd /d "%~dp0"
echo metriq-qa batch
echo.
if "%~1"=="" (
  node bin\metriq-qa.js batch
) else (
  node bin\metriq-qa.js batch "%~1"
)
echo.
pause
