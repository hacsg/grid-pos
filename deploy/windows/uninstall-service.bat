@echo off
rem Removes the grid-pos-daemon Windows service. RUN AS ADMINISTRATOR.
cd /d "%~dp0"
nssm.exe stop grid-pos-daemon
nssm.exe remove grid-pos-daemon confirm
pause
