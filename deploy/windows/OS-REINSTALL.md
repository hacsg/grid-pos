# Reinstalling Windows on a POS till

Runbook for putting a clean Windows on a POS machine that arrived with a vendor
image. Written from the Windows 7 → Windows 10 rebuilds; the gotchas below are
specific to cheap POS motherboards and cost real time the first time round.

Survey the machine first (`pos-survey.bat`, or `pos-survey-cmd.bat` if it has no
PowerShell) so you know the RAM, storage size and peripheral VID/PIDs before you
wipe anything. See [README](README.md#surveying-a-new-till).

---

## 1. Before you wipe

- **Image the existing disk** (Macrium Reflect Free, Clonezilla). If a driver
  turns out to be missing after the rebuild, this is the way back to a working
  till while you sort it out.
- **Collect drivers** for the touchscreen, receipt printer, pole display and any
  USB-serial bridge, using the VID/PID list from the survey. Put them on a second
  USB stick.
- **Check the storage size.** 32 GB eMMC will not hold a modern Windows install
  plus updates. Budget for an SSD swap rather than fighting it.

## 2. Build the install USB

**Use Rufus.** This is the step that most often goes wrong.

| Setting | Value |
|---|---|
| Boot selection | the Windows ISO |
| Image option | **Standard Windows installation** |
| Partition scheme | **MBR** |
| Target system | **BIOS or UEFI** |
| File system | **NTFS** |

MBR + NTFS boots on both legacy and UEFI machines — Rufus adds its own
`UEFI:NTFS` shim so the UEFI path still works. It is the most forgiving
combination on old POS firmware.

> If you don't have the ISO, Rufus can download official Microsoft images
> directly (the arrow next to SELECT).

**Do not use balenaEtcher, `dd`, or "DD Image" mode in Rufus** for a Windows ISO.
Those write the ISO9660/UDF layout byte-for-byte, which produces a stick that
Windows cannot mount and that often won't boot Windows Setup properly.

### Symptom: Windows says the stick "needs to be reformatted"

That message means the host can't read the USB's filesystem, and a Windows
install USB should always be readable. It points at one of:

- The stick was written in **image/dd mode** (Etcher, `dd`, Rufus DD mode).
- The stick was written **GPT** and is a *removable* flash drive — Windows 7 only
  exposes the first partition of removable media and handles GPT on it badly.
- The stick is **failing or counterfeit**. Cheap flash with faked capacity is
  common; if a correct rebuild still won't read, try a different stick.

Rebuild it with the settings in the table above.

### FAT32 and the 4 GB limit

UEFI natively boots FAT32, but `sources\install.wim` in a modern Windows ISO is
usually larger than FAT32's 4 GB per-file limit. Rufus works around this either
by splitting into `install.swm` or by using NTFS plus its UEFI shim. Let it
choose — don't force FAT32 by hand.

## 3. Getting the machine to actually boot it

The USB appearing in the BIOS disk list is *not* the same as it being in the boot
order. On cheap AMI-style POS firmware, these are the usual causes, roughly in
order of how often they're the answer:

1. **`Hard Drive BBS Priorities` is a separate menu.** USB flash drives enumerate
   as hard disks, so the top-level *Boot Option #1* points at "Hard Drive" as a
   category while the internal disk stays first *within* that category. Go to
   **Boot → Hard Drive BBS Priorities**, put the USB first there, *then* set
   Boot Option #1. Setting only the top-level order silently boots the internal
   disk — this is almost always what "I changed the boot order and it booted the
   old drive anyway" means.
2. **Use the one-time boot menu instead.** Usually `F7`, `F8`, `F11`, `F12` or
   `Esc` at power-on. It bypasses the boot-order menus entirely and is the
   fastest way to test whether the stick is bootable at all.
3. **Use a USB 2.0 port.** Many POS boards have no XHCI support in legacy BIOS
   and simply cannot boot from USB 3.0 ports. Use a rear port directly on the
   board — not a front-panel header, not a hub.
4. **Disable Fast Boot.** It skips USB enumeration during POST.
5. **Pick the right entry.** With CSM enabled the stick appears twice: `UEFI: <name>`
   and a plain `<name>` (legacy). For an MBR/NTFS stick, try the plain legacy
   entry first.
6. **Disable Secure Boot** if the firmware has it.

## 4. UEFI or legacy?

Either works for a till. Decide once and stay consistent:

- **Legacy / MBR** — simplest, most reliable on this class of hardware, and
  matches what the machine is already doing. Fine for a till that will never run
  Windows 11.
- **UEFI / GPT** — the better long-term target and *required* if you ever want
  Windows 11 on the box. The disk must be GPT, so delete every existing partition
  during setup.

Whichever you pick, **delete all existing partitions** at the drive-selection
screen rather than installing alongside the vendor image.

## 5. After the install

1. Windows Update, then the peripheral drivers you collected in step 1.
2. Check Device Manager for anything unresolved — or re-run the survey and read
   its *Devices with a driver problem* section.
3. Install Chrome.
4. `setup-pos-pc.bat` — installs the KPay daemon as a service.
5. `start-pos-mode.ps1` — configure `$PosUrl`, then set up auto-start.
6. Set the customer-facing screen as the Windows **secondary** monitor, or set
   `$SwapMonitors = $true`.

Once every till is on Windows 10+, two pins can be lifted: the Go 1.20 toolchain
on `kpay-daemon` (see [WINDOWS_SETUP.md](../../services/kpay-daemon/WINDOWS_SETUP.md))
and the PowerShell 2.0 constraint on the scripts in this folder.

## Licensing

Read [the OEM key section](README.md#reading-the-oem-key-on-a-windows-7-machine)
before buying anything — if the machine carries a firmware OEM licence, a clean
install self-activates and there is no key to buy.

Windows also installs and runs **unactivated** indefinitely: you get a watermark
and locked personalisation settings, but updates, drivers and Chrome all work.
That is a legitimate way to get a till into service while a licence is sorted
out — you are not blocked on the key.
