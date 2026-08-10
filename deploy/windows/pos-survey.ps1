# =============================================================================
#  Grid POS — machine survey
# =============================================================================
#  Dumps everything needed to plan an OS upgrade or driver hunt on a POS till:
#  hardware, storage, firmware, Windows licence/activation state, printers,
#  serial ports and attached USB devices.
#
#  Read-only. Changes nothing on the machine.
#
#  Run it via pos-survey.bat (right-click -> Run as administrator). Output
#  lands in pos-survey.txt next to the script and opens in Notepad.
#
#  Written for Windows PowerShell 2.0 (the version that ships with Windows 7),
#  so it deliberately avoids Get-CimInstance, [pscustomobject], Get-Printer,
#  Get-PnpDevice and other PS3+ cmdlets. Do not "modernise" it unless every
#  till has been upgraded.
# =============================================================================

$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutFile   = Join-Path $scriptDir 'pos-survey.txt'

if (Test-Path $OutFile) { Remove-Item $OutFile -Force -ErrorAction SilentlyContinue }

function Write-Line($text) {
    $text | Out-File -FilePath $OutFile -Append -Encoding UTF8
}

function Write-Section($title) {
    Write-Line ''
    Write-Line ('=' * 74)
    Write-Line ("  $title")
    Write-Line ('=' * 74)
}

# Runs a block, writes its output, and records the error instead of dying.
function Write-Probe($label, $block) {
    Write-Line ''
    Write-Line "--- $label ---"
    try {
        $result = & $block
        if ($null -eq $result -or ($result -is [array] -and $result.Count -eq 0)) {
            Write-Line '(no data)'
        } else {
            Write-Line (($result | Out-String -Width 200).TrimEnd())
        }
    } catch {
        Write-Line "(unavailable: $($_.Exception.Message))"
    }
}

function Get-Wmi($class, $namespace) {
    if ($namespace) { Get-WmiObject -Class $class -Namespace $namespace }
    else            { Get-WmiObject -Class $class }
}

function Format-GB($bytes) {
    if (-not $bytes) { return 'unknown' }
    '{0:N1} GB' -f ($bytes / 1GB)
}

# --- header ------------------------------------------------------------------

Write-Line 'GRID POS - MACHINE SURVEY'
Write-Line ("Generated : " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Line ("Hostname  : " + $env:COMPUTERNAME)
Write-Line ("Run as    : " + $env:USERNAME)
Write-Line ("PowerShell: " + $PSVersionTable.PSVersion.ToString())

$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$admin     = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Line ("Elevated  : " + $admin)
if (-not $admin) {
    Write-Line ''
    Write-Line '*** NOT RUNNING AS ADMINISTRATOR — the firmware OEM key and some'
    Write-Line '*** hardware details will be missing. Re-run via pos-survey.bat'
    Write-Line '*** with right-click -> Run as administrator.'
}

# --- system ------------------------------------------------------------------

Write-Section 'SYSTEM'

Write-Probe 'Computer' {
    Get-Wmi Win32_ComputerSystem |
        Select-Object Manufacturer, Model, SystemType,
                      NumberOfProcessors, NumberOfLogicalProcessors,
                      TotalPhysicalMemory
}

Write-Probe 'Baseboard' {
    Get-Wmi Win32_BaseBoard | Select-Object Manufacturer, Product, Version, SerialNumber
}

Write-Probe 'CPU' {
    Get-Wmi Win32_Processor |
        Select-Object Name, Description, NumberOfCores, NumberOfLogicalProcessors,
                      MaxClockSpeed, AddressWidth
}

# --- operating system --------------------------------------------------------

Write-Section 'OPERATING SYSTEM'

Write-Probe 'Windows' {
    Get-Wmi Win32_OperatingSystem |
        Select-Object Caption, Version, BuildNumber, OSArchitecture, ServicePackMajorVersion,
                      InstallDate, LastBootUpTime, SystemDirectory,
                      OSLanguage, MUILanguages, CountryCode, Locale
}

# A vendor Ghost image is usually obvious here: a build date far older than the
# machine, or a locale/language pair that doesn't match what was ordered.
Write-Probe 'Locale / regional settings' {
    "System locale (WMI Locale)  : " + (Get-Wmi Win32_OperatingSystem).Locale
    "Culture (current session)   : " + (Get-Culture).Name + ' / ' + (Get-Culture).DisplayName
    "UI culture                  : " + (Get-UICulture).Name + ' / ' + (Get-UICulture).DisplayName
    "Console code page           : " + (chcp)
    "TimeZone                    : " + (Get-Wmi Win32_TimeZone).Caption
}

# --- memory ------------------------------------------------------------------

Write-Section 'MEMORY'

Write-Probe 'Total' {
    $cs = Get-Wmi Win32_ComputerSystem
    "Installed RAM : " + (Format-GB $cs.TotalPhysicalMemory)
}

Write-Probe 'Modules and slots' {
    Get-Wmi Win32_PhysicalMemory |
        Select-Object DeviceLocator, BankLabel, Manufacturer, PartNumber,
                      @{ n = 'Size'; e = { Format-GB $_.Capacity } },
                      Speed, MemoryType
}

Write-Probe 'Slot capacity (how much room to upgrade)' {
    Get-Wmi Win32_PhysicalMemoryArray |
        Select-Object MemoryDevices,
                      @{ n = 'MaxCapacity'; e = { Format-GB ($_.MaxCapacity * 1KB) } }
}

# --- storage -----------------------------------------------------------------

Write-Section 'STORAGE'

# Model name is the tell for eMMC modules, which are common on cheap POS boxes
# and are usually too small (32 GB) for a modern Windows install.
Write-Probe 'Physical disks' {
    Get-Wmi Win32_DiskDrive |
        Select-Object Index, Model, InterfaceType, MediaType, Partitions,
                      @{ n = 'Size'; e = { Format-GB $_.Size } },
                      SerialNumber
}

# Type reports "GPT: ..." on GPT disks, which means the machine almost certainly
# booted UEFI. "Installable File System" and friends mean MBR / legacy BIOS.
Write-Probe 'Partitions (GPT vs MBR)' {
    Get-Wmi Win32_DiskPartition |
        Select-Object DiskIndex, Index, Name, Type, Bootable, BootPartition,
                      @{ n = 'Size'; e = { Format-GB $_.Size } }
}

Write-Probe 'Volumes and free space' {
    Get-Wmi Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } |
        Select-Object DeviceID, VolumeName, FileSystem,
                      @{ n = 'Size';  e = { Format-GB $_.Size } },
                      @{ n = 'Free';  e = { Format-GB $_.FreeSpace } },
                      @{ n = 'Free%'; e = { if ($_.Size) { '{0:N0}%' -f (100 * $_.FreeSpace / $_.Size) } } }
}

# --- firmware ----------------------------------------------------------------

Write-Section 'FIRMWARE / BIOS'

Write-Probe 'BIOS' {
    Get-Wmi Win32_BIOS |
        Select-Object Manufacturer, Name, SMBIOSBIOSVersion, Version,
                      ReleaseDate, SerialNumber
}

Write-Probe 'Boot mode hints' {
    $efiVar = Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State'
    "SecureBoot registry key present : $efiVar  (absent on Windows 7 / legacy BIOS)"
    $gpt = @(Get-Wmi Win32_DiskPartition | Where-Object { $_.Type -like 'GPT*' })
    "GPT partitions found            : " + $gpt.Count + "  (>0 strongly suggests UEFI boot)"
    "Windows folder                  : $env:SystemRoot"
    "PROCESSOR_ARCHITECTURE          : $env:PROCESSOR_ARCHITECTURE"
}

Write-Probe 'TPM (needed for Windows 11)' {
    $tpm = Get-Wmi Win32_Tpm 'root\CIMV2\Security\MicrosoftTpm'
    if ($tpm) {
        $tpm | Select-Object SpecVersion, ManufacturerIdTxt, ManufacturerVersion,
                             IsEnabled_InitialValue, IsActivated_InitialValue
    } else {
        'No TPM reported (namespace missing on Windows 7 even when a TPM exists — check BIOS setup)'
    }
}

# --- licensing ---------------------------------------------------------------

Write-Section 'WINDOWS LICENCE / ACTIVATION'

# The one that matters: a key here means the machine carries a firmware-embedded
# OEM licence and a clean Windows install will self-activate with no key to buy.
Write-Probe 'Firmware-embedded OEM key (OA3xOriginalProductKey)' {
    $svc = Get-Wmi SoftwareLicensingService
    if ($svc -and $svc.OA3xOriginalProductKey) {
        "FOUND: " + $svc.OA3xOriginalProductKey
        "-> This machine has a firmware OEM licence. A clean Windows install"
        "   should activate automatically. No key purchase needed."
    } else {
        "NONE — no OEM key embedded in firmware."
        "-> A clean install will need a licence key supplied separately."
    }
}

Write-Probe 'Current activation state' {
    # Description carries the channel: OEM_SLP / RETAIL / VOLUME_KMSCLIENT.
    # VOLUME_KMSCLIENT on a single retail till is the signature of a KMS crack.
    Get-Wmi SoftwareLicensingProduct |
        Where-Object { $_.PartialProductKey } |
        Select-Object Name, Description, PartialProductKey,
                      @{ n = 'LicenseStatus'; e = {
                            # Bind first: inside switch, $_ becomes the switch input.
                            $status = $_.LicenseStatus
                            switch ($status) {
                                0 { '0 Unlicensed' }
                                1 { '1 Licensed' }
                                2 { '2 OOB grace' }
                                3 { '3 OOT grace' }
                                4 { '4 Non-genuine grace' }
                                5 { '5 Notification' }
                                6 { '6 Extended grace' }
                                default { "$status" }
                            } } }
}

Write-Probe 'KMS server configuration (should be blank on a genuine machine)' {
    $svc = Get-Wmi SoftwareLicensingService
    "KeyManagementServiceMachine : " + $svc.KeyManagementServiceMachine
    "KeyManagementServicePort    : " + $svc.KeyManagementServicePort
    "DiscoveredKeyManagementServiceMachineName : " + $svc.DiscoveredKeyManagementServiceMachineName
}

# --- display -----------------------------------------------------------------

Write-Section 'DISPLAY'

Write-Probe 'Video controllers' {
    Get-Wmi Win32_VideoController |
        Select-Object Name, VideoProcessor, DriverVersion, DriverDate,
                      CurrentHorizontalResolution, CurrentVerticalResolution,
                      VideoModeDescription, Status
}

# Grid POS runs staff till on the primary monitor and customer display on the
# secondary, so the monitor count matters for start-pos-mode.ps1.
Write-Probe 'Monitors attached' {
    $mon = @(Get-Wmi Win32_DesktopMonitor)
    "Count: " + $mon.Count
    $mon | Select-Object Name, DeviceID, MonitorType, ScreenWidth, ScreenHeight, Status
}

# --- peripherals -------------------------------------------------------------

Write-Section 'PRINTERS'

Write-Probe 'Installed printers' {
    Get-Wmi Win32_Printer |
        Select-Object Name, DriverName, PortName, Default, Shared, Network,
                      PrinterStatus, WorkOffline
}

Write-Probe 'Printer drivers' {
    Get-Wmi Win32_PrinterDriver | Select-Object Name, Version, DriverPath
}

Write-Probe 'Printer ports' {
    Get-Wmi Win32_TCPIPPrinterPort | Select-Object Name, HostAddress, PortNumber, Protocol
}

Write-Section 'SERIAL PORTS'

# Pole displays, scales and some cash-drawer boxes appear here, usually behind a
# CH340 / PL2303 / FTDI USB-serial bridge that needs a vendor driver on Win10+.
Write-Probe 'COM ports' {
    Get-Wmi Win32_SerialPort | Select-Object DeviceID, Name, Description, ProviderType
}

Write-Probe 'Serial port config' {
    Get-Wmi Win32_SerialPortConfiguration | Select-Object Name, BaudRate, BitsPerByte, Parity, StopBits
}

Write-Section 'USB AND PNP DEVICES'

# Anything with a driver problem shows up here first — this is the list to check
# after an OS upgrade.
Write-Probe 'Devices with problems (error code != 0)' {
    Get-Wmi Win32_PnPEntity |
        Where-Object { $_.ConfigManagerErrorCode -ne 0 } |
        Select-Object Name, DeviceID, ConfigManagerErrorCode, Status
}

Write-Probe 'Likely POS peripherals (touch / serial-bridge / printer / HID)' {
    $pattern = 'touch|CH34|CH91|PL2303|Prolific|FTDI|FT232|Silicon Labs|CP210|' +
               'printer|POS|receipt|thermal|scanner|barcode|scale|display|' +
               'card reader|MSR|smart ?card|drawer|serial|USB-SERIAL'
    Get-Wmi Win32_PnPEntity |
        Where-Object { $_.Name -match $pattern -or $_.Description -match $pattern } |
        Select-Object Name, Manufacturer, DeviceID, Service, Status |
        Sort-Object Name
}

Write-Probe 'USB controllers' {
    Get-Wmi Win32_USBController | Select-Object Name, Manufacturer, DeviceID, Status
}

Write-Probe 'All USB device IDs (VID/PID — use these to find drivers)' {
    Get-Wmi Win32_PnPEntity |
        Where-Object { $_.DeviceID -like 'USB\VID_*' } |
        Select-Object Name, DeviceID, Service |
        Sort-Object Name
}

# --- network -----------------------------------------------------------------

Write-Section 'NETWORK'

Write-Probe 'Adapters' {
    Get-Wmi Win32_NetworkAdapter |
        Where-Object { $_.PhysicalAdapter -eq $true } |
        Select-Object Name, Manufacturer, MACAddress, NetConnectionID, Speed, NetEnabled
}

Write-Probe 'IP configuration' {
    Get-Wmi Win32_NetworkAdapterConfiguration |
        Where-Object { $_.IPEnabled -eq $true } |
        Select-Object Description, MACAddress,
                      @{ n = 'IPAddress';  e = { $_.IPAddress -join ', ' } },
                      @{ n = 'Gateway';    e = { $_.DefaultIPGateway -join ', ' } },
                      @{ n = 'DNS';        e = { $_.DNSServerSearchOrder -join ', ' } },
                      DHCPEnabled
}

# --- software ----------------------------------------------------------------

Write-Section 'RELEVANT SOFTWARE'

Write-Probe 'Chrome' {
    $paths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $found = $false
    foreach ($p in $paths) {
        if (Test-Path $p) {
            $found = $true
            $v = (Get-Item $p).VersionInfo.ProductVersion
            "$p  -> version $v"
        }
    }
    if (-not $found) { 'Chrome not found in the standard locations' }
}

Write-Probe 'Grid POS daemon service' {
    $svc = Get-Wmi Win32_Service |
        Where-Object { $_.Name -match 'grid-pos-daemon|KPayDaemon' }
    if ($svc) { $svc | Select-Object Name, State, StartMode, PathName, StartName }
    else      { 'Not installed' }
}

Write-Probe '.NET versions present' {
    $key = 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP'
    if (Test-Path $key) {
        Get-ChildItem $key -Recurse |
            Get-ItemProperty -Name Version -ErrorAction SilentlyContinue |
            Select-Object PSChildName, Version
    } else { '(none reported)' }
}

# --- done --------------------------------------------------------------------

Write-Line ''
Write-Line ('=' * 74)
Write-Line '  END OF SURVEY'
Write-Line ('=' * 74)
Write-Line ''
Write-Line 'Nothing on this machine was modified. Send pos-survey.txt on for review.'

Write-Host ''
Write-Host "Survey written to: $OutFile" -ForegroundColor Green
Write-Host ''
