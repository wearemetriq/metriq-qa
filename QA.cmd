@echo off
rem Double-click this file, paste a URL, and the report opens when the check finishes.
cd /d "%~dp0"
echo metriq-qa
echo.
echo Paste a site address, for example mudhenclayandart.com or a webflow.io staging link.
echo Add --only after it to check just that one page.
echo.
set "QA_URL="
set /p "QA_URL=URL: "
if not defined QA_URL goto :eof
echo.
node bin\metriq-qa.js %QA_URL%
echo.
pause
