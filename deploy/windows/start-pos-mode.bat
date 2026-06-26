@echo off
REM Grid POS - "POS mode" launcher.
REM Double-click to start, or place a shortcut to this file in the Startup folder
REM (Win+R -> shell:startup) so it runs automatically at login.
REM
REM Runs start-pos-mode.ps1 with the execution policy bypassed for this process
REM only (does not change machine-wide PowerShell settings).

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-pos-mode.ps1"
