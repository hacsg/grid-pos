@echo off
REM ===========================================================================
REM  Grid POS - machine survey (CMD-only fallback)
REM ===========================================================================
REM  Same job as pos-survey.bat / pos-survey.ps1, but uses nothing except
REM  built-in CMD tools: wmic, reg, sc, diskpart, ipconfig, systeminfo.
REM
REM  Use this one when the machine has no PowerShell. Stripped vendor "Ghost"
REM  images - common on cheap POS hardware - often have it removed.
REM
REM  Read-only. Changes nothing on the machine.
REM
REM  Right-click -> Run as administrator. Output lands in pos-survey.txt next
REM  to this file and opens in Notepad when finished.
REM
REM  Note on encoding: wmic writes UTF-16 when redirected straight to a file,
REM  which produces a file full of null bytes. Piping through MORE re-encodes
REM  to the console code page, so every wmic call below ends with "| more".
REM ===========================================================================

REM Plain setlocal, NOT enabledelayedexpansion: several wmic filters below use
REM "!=" and would be mangled by delayed expansion.
setlocal
set "OUT=%~dp0pos-survey.txt"
set "DPSCRIPT=%TEMP%\gridpos-diskpart.txt"

REM %ProgramFiles(x86)% carries parentheses in its own name, which breaks
REM parsing if it is expanded inside an if/else block. Resolve it once here, on
REM its own line, and use the plain copies later.
set "CHROME_PF=%ProgramFiles%\Google\Chrome\Application"
set "CHROME_PF86=%ProgramFiles(x86)%\Google\Chrome\Application"
set "CHROME_LOCAL=%LOCALAPPDATA%\Google\Chrome\Application"

if exist "%OUT%" del /f /q "%OUT%" >nul 2>&1

echo.
echo  Grid POS - collecting machine details...
echo  This takes about a minute. Please wait.
echo.

REM --- header --------------------------------------------------------------

REM Every echo of a variable keeps a space before >>. Values like %TIME% and
REM AMD64 end in a digit, and "4>>" would be parsed as a redirect, not text.
echo GRID POS - MACHINE SURVEY ^(CMD-only collector^) >>"%OUT%"
echo Generated : %DATE% %TIME% >>"%OUT%"
echo Hostname  : %COMPUTERNAME% >>"%OUT%"
echo Run as    : %USERDOMAIN%\%USERNAME% >>"%OUT%"
echo Arch      : %PROCESSOR_ARCHITECTURE% >>"%OUT%"

REM Writing to a system location is the reliable elevation test on Windows 7.
net session >nul 2>&1
if errorlevel 1 (
    echo Elevated  : NO>>"%OUT%"
    echo.>>"%OUT%"
    echo *** NOT RUNNING AS ADMINISTRATOR - the licence key and some hardware>>"%OUT%"
    echo *** details will be missing. Re-run with right-click -^> Run as administrator.>>"%OUT%"
) else (
    echo Elevated  : YES>>"%OUT%"
)

REM --- which tools survived the image? --------------------------------------
REM This section is diagnostic in its own right: the more that is missing, the
REM more heavily the vendor stripped Windows, and the less the machine can be
REM trusted as-is.

call :hdr "AVAILABLE TOOLING - what this Windows image still has"

call :sub "Interpreters and utilities"
call :probe wmic.exe
call :probe reg.exe
call :probe sc.exe
call :probe systeminfo.exe
call :probe diskpart.exe
call :probe driverquery.exe
call :probe ipconfig.exe
call :probe cscript.exe
call :probe net.exe

call :sub "PowerShell - checked by path, not by PATH variable"
REM A missing PATH entry is not the same as a missing install, so look directly.
if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
    echo FOUND    : %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe>>"%OUT%"
) else (
    echo MISSING  : %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe>>"%OUT%"
)
if exist "%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" (
    echo FOUND    : %SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe>>"%OUT%"
) else (
    echo MISSING  : %SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe>>"%OUT%"
)
reg query "HKLM\SOFTWARE\Microsoft\PowerShell\1" /v Install 2>&1 | more >>"%OUT%"
reg query "HKLM\SOFTWARE\Microsoft\PowerShell\1\PowerShellEngine" /v PowerShellVersion 2>&1 | more >>"%OUT%"
echo.>>"%OUT%"
echo NOTE: PowerShell 2.0 needs .NET 2.0/3.5. If .NET was stripped too,>>"%OUT%"
echo       powershell.exe can be present and still refuse to start.>>"%OUT%"
echo       Grid POS's start-pos-mode.ps1 kiosk launcher requires PowerShell.>>"%OUT%"

REM WMIC does the heavy lifting; without it this script cannot do much.
where wmic.exe >nul 2>&1
if errorlevel 1 (
    echo.>>"%OUT%"
    echo *** WMIC IS MISSING - almost every section below will be empty.>>"%OUT%"
    echo *** This image is stripped past the point of being worth repairing.>>"%OUT%"
    goto :finish
)

REM /format:list gives readable Key=Value output, but the XSL files it needs are
REM sometimes stripped as well. Test once and fall back to table output.
set "FMT=/format:list"
wmic os get Caption %FMT% >nul 2>&1
if errorlevel 1 (
    set "FMT="
    echo.>>"%OUT%"
    echo NOTE: wmic /format:list unavailable ^(XSL files stripped^); using table output.>>"%OUT%"
)

REM --- system --------------------------------------------------------------

call :hdr "SYSTEM"

call :sub "Computer"
wmic computersystem get Manufacturer,Model,SystemType,NumberOfProcessors,NumberOfLogicalProcessors,TotalPhysicalMemory %FMT% 2>&1 | more >>"%OUT%"

call :sub "Baseboard"
wmic baseboard get Manufacturer,Product,Version,SerialNumber %FMT% 2>&1 | more >>"%OUT%"

call :sub "CPU"
wmic cpu get Name,Description,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,AddressWidth %FMT% 2>&1 | more >>"%OUT%"

REM --- operating system ----------------------------------------------------

call :hdr "OPERATING SYSTEM"

call :sub "Version banner"
ver 2>&1 | more >>"%OUT%"

call :sub "Windows"
wmic os get Caption,Version,BuildNumber,OSArchitecture,ServicePackMajorVersion,InstallDate,LastBootUpTime,Locale,OSLanguage,CountryCode %FMT% 2>&1 | more >>"%OUT%"

call :sub "Registry product details"
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v ProductName 2>&1 | more >>"%OUT%"
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v EditionID 2>&1 | more >>"%OUT%"
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v CurrentBuild 2>&1 | more >>"%OUT%"
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v InstallDate 2>&1 | more >>"%OUT%"

call :sub "Locale and code page"
chcp 2>&1 | more >>"%OUT%"
wmic timezone get Caption %FMT% 2>&1 | more >>"%OUT%"

REM --- memory --------------------------------------------------------------

call :hdr "MEMORY"

call :sub "Installed modules"
wmic memorychip get DeviceLocator,BankLabel,Manufacturer,PartNumber,Capacity,Speed,MemoryType %FMT% 2>&1 | more >>"%OUT%"

call :sub "Slot count and maximum capacity - upgrade headroom"
wmic memphysical get MemoryDevices,MaxCapacity %FMT% 2>&1 | more >>"%OUT%"

REM --- storage -------------------------------------------------------------

call :hdr "STORAGE"

call :sub "Physical disks - watch for a small eMMC module"
wmic diskdrive get Index,Model,InterfaceType,MediaType,Partitions,Size,SerialNumber %FMT% 2>&1 | more >>"%OUT%"

call :sub "Partitions - Type says GPT on UEFI machines"
wmic partition get DiskIndex,Index,Name,Type,Bootable,BootPartition,Size %FMT% 2>&1 | more >>"%OUT%"

call :sub "Volumes and free space"
wmic logicaldisk where "DriveType=3" get DeviceID,VolumeName,FileSystem,Size,FreeSpace %FMT% 2>&1 | more >>"%OUT%"

call :sub "diskpart - the Gpt column marks GPT disks with an asterisk"
echo list disk>"%DPSCRIPT%"
diskpart /s "%DPSCRIPT%" 2>&1 | more >>"%OUT%"
del /f /q "%DPSCRIPT%" >nul 2>&1

REM --- firmware ------------------------------------------------------------

call :hdr "FIRMWARE / BIOS"

call :sub "BIOS"
wmic bios get Manufacturer,Name,SMBIOSBIOSVersion,Version,ReleaseDate,SerialNumber %FMT% 2>&1 | more >>"%OUT%"

call :sub "Secure Boot key - absent on Windows 7 and on legacy BIOS"
reg query "HKLM\SYSTEM\CurrentControlSet\Control\SecureBoot\State" 2>&1 | more >>"%OUT%"

REM --- licensing -----------------------------------------------------------

call :hdr "WINDOWS LICENCE / ACTIVATION"

call :sub "Firmware-embedded OEM key"
echo READ THIS FIRST:>>"%OUT%"
echo   OA3xOriginalProductKey is a Windows 8+ property. On Windows 7 the query>>"%OUT%"
echo   below usually fails EVEN IF the machine has a firmware key, because>>"%OUT%"
echo   Windows 7 cannot read the UEFI MSDM table. A failure here is NOT proof>>"%OUT%"
echo   that the machine lacks an OEM licence - see README for how to read the>>"%OUT%"
echo   key from Windows Setup or a Linux live USB instead.>>"%OUT%"
echo.>>"%OUT%"
wmic path softwarelicensingservice get OA3xOriginalProductKey %FMT% 2>&1 | more >>"%OUT%"

call :sub "Activation state - Description carries the licence channel"
echo OEM_SLP or RETAIL = a real licence. VOLUME_KMSCLIENT on a standalone till>>"%OUT%"
echo means the image was activated against a KMS crack.>>"%OUT%"
echo LicenseStatus: 0 unlicensed, 1 licensed, 2 OOB grace, 3 OOT grace,>>"%OUT%"
echo                4 non-genuine grace, 5 notification, 6 extended grace.>>"%OUT%"
echo.>>"%OUT%"
wmic path softwarelicensingproduct where "PartialProductKey is not null" get Name,Description,PartialProductKey,LicenseStatus %FMT% 2>&1 | more >>"%OUT%"

call :sub "KMS configuration - should be blank on a genuine machine"
wmic path softwarelicensingservice get KeyManagementServiceMachine,KeyManagementServicePort,DiscoveredKeyManagementServiceMachineName %FMT% 2>&1 | more >>"%OUT%"

call :sub "slmgr /dlv - fuller licence detail, needs Windows Script Host"
if exist "%SystemRoot%\System32\slmgr.vbs" (
    cscript //nologo "%SystemRoot%\System32\slmgr.vbs" /dlv 2>&1 | more >>"%OUT%"
) else (
    echo slmgr.vbs not present - stripped from this image.>>"%OUT%"
)

REM --- display -------------------------------------------------------------

call :hdr "DISPLAY"

call :sub "Video controllers"
wmic path win32_videocontroller get Name,VideoProcessor,DriverVersion,DriverDate,CurrentHorizontalResolution,CurrentVerticalResolution,Status %FMT% 2>&1 | more >>"%OUT%"

call :sub "Monitors - Grid POS needs two for the customer display"
wmic desktopmonitor get Name,DeviceID,MonitorType,ScreenWidth,ScreenHeight,Status %FMT% 2>&1 | more >>"%OUT%"

REM --- peripherals ---------------------------------------------------------

call :hdr "PRINTERS"

call :sub "Installed printers"
wmic printer get Name,DriverName,PortName,Default,Shared,Network,PrinterStatus,WorkOffline %FMT% 2>&1 | more >>"%OUT%"

call :sub "Printer drivers"
wmic path win32_printerdriver get Name,Version %FMT% 2>&1 | more >>"%OUT%"

call :hdr "SERIAL PORTS"

call :sub "COM ports - pole displays, scales, some cash drawer boxes"
wmic path win32_serialport get DeviceID,Name,Description,ProviderType %FMT% 2>&1 | more >>"%OUT%"

call :sub "Registry SERIALCOMM map"
reg query "HKLM\HARDWARE\DEVICEMAP\SERIALCOMM" 2>&1 | more >>"%OUT%"

call :hdr "USB AND PNP DEVICES"

call :sub "Devices with a driver problem - check these first after any reinstall"
wmic path win32_pnpentity where "ConfigManagerErrorCode!=0" get Name,DeviceID,ConfigManagerErrorCode,Status %FMT% 2>&1 | more >>"%OUT%"

call :sub "Likely POS peripherals"
REM findstr filters the flat dump for the device families that actually need a
REM vendor driver on Windows 10/11.
wmic path win32_pnpentity get Name,DeviceID 2>&1 | more | findstr /i /c:"touch" /c:"CH34" /c:"CH91" /c:"PL2303" /c:"Prolific" /c:"FTDI" /c:"FT232" /c:"CP210" /c:"Silicon Labs" /c:"printer" /c:"POS" /c:"receipt" /c:"thermal" /c:"scanner" /c:"barcode" /c:"scale" /c:"card reader" /c:"MSR" /c:"drawer" /c:"USB-SERIAL" /c:"serial" >>"%OUT%"

call :sub "All USB device IDs - the VID/PID values used to find drivers"
wmic path win32_pnpentity get Name,DeviceID,Service 2>&1 | more | findstr /i /c:"USB\VID_" >>"%OUT%"

call :sub "USB controllers"
wmic path win32_usbcontroller get Name,Manufacturer,DeviceID,Status %FMT% 2>&1 | more >>"%OUT%"

call :sub "Loaded drivers"
driverquery 2>&1 | more >>"%OUT%"

REM --- network -------------------------------------------------------------

call :hdr "NETWORK"

call :sub "Physical adapters"
wmic nic where "PhysicalAdapter=true" get Name,Manufacturer,MACAddress,NetConnectionID,Speed,NetEnabled %FMT% 2>&1 | more >>"%OUT%"

call :sub "IP configuration"
ipconfig /all 2>&1 | more >>"%OUT%"

REM --- software ------------------------------------------------------------

call :hdr "RELEVANT SOFTWARE"

call :sub "Chrome - Windows 7 caps out at Chrome 109"
REM Chrome keeps its build in a version-named subfolder of Application\, so a
REM plain dir reports the version without any WQL path-escaping games.
call :chrome "%CHROME_PF%"
call :chrome "%CHROME_PF86%"
call :chrome "%CHROME_LOCAL%"

call :sub "Grid POS daemon service"
sc query grid-pos-daemon 2>&1 | more >>"%OUT%"
sc query KPayDaemon 2>&1 | more >>"%OUT%"

call :sub ".NET versions - PowerShell 2.0 depends on 2.0/3.5"
reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP" /s /v Version 2>&1 | more >>"%OUT%"

call :sub "Windows Script Host"
if exist "%SystemRoot%\System32\cscript.exe" (echo FOUND: cscript.exe>>"%OUT%") else (echo MISSING: cscript.exe>>"%OUT%")

REM --- systeminfo last: it is the slowest command here ----------------------

call :hdr "SYSTEMINFO - full dump"
systeminfo 2>&1 | more >>"%OUT%"

:finish

echo.>>"%OUT%"
echo ======================================================================>>"%OUT%"
echo   END OF SURVEY>>"%OUT%"
echo ======================================================================>>"%OUT%"
echo.>>"%OUT%"
echo Nothing on this machine was modified.>>"%OUT%"

echo.
echo  Done. Written to: %OUT%
echo.

if exist "%OUT%" (
    start notepad "%OUT%"
) else (
    echo  ERROR: pos-survey.txt was not created. Scroll up for the reason.
    pause
)

endlocal
goto :eof

REM --- helpers -------------------------------------------------------------

REM The trailing space before >> matters: without it, a label ending in a digit
REM would make CMD read "...2>>" as a stderr redirect instead of text.
:hdr
echo.>>"%OUT%"
echo ======================================================================>>"%OUT%"
echo   %~1 >>"%OUT%"
echo ======================================================================>>"%OUT%"
goto :eof

REM Reports a Chrome install and its version, read from the version-named
REM subfolder Chrome creates under Application\.
:chrome
if not exist "%~1\chrome.exe" goto :eof
echo FOUND: %~1\chrome.exe >>"%OUT%"
for /d %%V in ("%~1\*") do echo    version: %%~nxV >>"%OUT%"
goto :eof

:sub
echo.>>"%OUT%"
echo --- %~1 --->>"%OUT%"
goto :eof

REM Reports whether a command exists on PATH, without running it.
:probe
where %1 >nul 2>&1
if errorlevel 1 (echo MISSING  : %1 >>"%OUT%") else (echo present  : %1 >>"%OUT%")
goto :eof
