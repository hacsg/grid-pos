@echo off
REM Grid POS - machine survey.
REM
REM Right-click this file -> "Run as administrator". It collects hardware,
REM firmware, Windows licence and peripheral details into pos-survey.txt in this
REM folder, then opens the file in Notepad.
REM
REM Read-only: it changes nothing on the machine.
REM
REM Runs pos-survey.ps1 with the execution policy bypassed for this process only
REM (does not change machine-wide PowerShell settings).

echo.
echo  Grid POS - collecting machine details...
echo  This takes about 30 seconds. Please wait.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pos-survey.ps1"

if exist "%~dp0pos-survey.txt" (
    start notepad "%~dp0pos-survey.txt"
) else (
    echo.
    echo  ERROR: pos-survey.txt was not created. Scroll up for the reason.
    echo.
    pause
)
