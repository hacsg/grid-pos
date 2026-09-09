@echo off
REM Double-clickable wrapper for the KPay certification test harness.
REM Runs the PowerShell script with an execution-policy bypass so it works
REM on a machine set to Restricted.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kpay-cert-test.ps1"
echo.
pause
