@echo off
rem Grid POS PC setup: install kpay-daemon as an auto-start Windows service
rem and silence Chrome's Windows 7 "unsupported OS" warning.
rem Run as administrator. All output lands in setup-log.txt (opens at the end).

cd /d "%~dp0"
call :main >> "%~dp0setup-log.txt" 2>&1
start notepad "%~dp0setup-log.txt"
exit /b

:main
echo ============================================
echo Run at %date% %time%
echo Folder: %~dp0
whoami
whoami /groups | findstr "S-1-16"

echo [1/3] Stopping any console instance of the daemon...
taskkill /IM kpay-daemon.exe /F

echo [2/3] Installing grid-pos-daemon service...
nssm.exe stop grid-pos-daemon
nssm.exe remove grid-pos-daemon confirm
nssm.exe install grid-pos-daemon "%~dp0kpay-daemon.exe"
nssm.exe set grid-pos-daemon AppDirectory "%~dp0"
nssm.exe set grid-pos-daemon AppStdout "%~dp0daemon.log"
nssm.exe set grid-pos-daemon AppStderr "%~dp0daemon.log"
nssm.exe set grid-pos-daemon AppRotateFiles 1
nssm.exe set grid-pos-daemon AppRotateBytes 1048576
nssm.exe set grid-pos-daemon Start SERVICE_AUTO_START
nssm.exe set grid-pos-daemon AppExit Default Restart
nssm.exe set grid-pos-daemon AppRestartDelay 5000
nssm.exe start grid-pos-daemon

echo [3/3] Suppressing Chrome unsupported-OS warning...
reg add "HKLM\Software\Policies\Google\Chrome" /v SuppressUnsupportedOSWarning /t REG_DWORD /d 1 /f

echo Final service status:
nssm.exe status grid-pos-daemon
echo ===== done =====
exit /b
