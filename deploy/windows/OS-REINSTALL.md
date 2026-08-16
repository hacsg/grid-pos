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
- **Look for a vendor driver partition on the internal disk.** These machines
  often ship drivers on a second partition and nowhere else, so a wipe destroys
  the only copy. See [rescuing it](#first-rescue-the-vendors-driver-partition).
- **Check the storage size.** 32 GB eMMC will not hold a modern Windows install
  plus updates. Budget for an SSD swap rather than fighting it.

## 2. Build the install USB

**Microsoft's Media Creation Tool is fine** and is the simplest option: it writes
FAT32 + MBR with `install.wim` split as needed, which boots both legacy and UEFI.
If you used MCT, the stick is almost certainly not your problem — go to
[step 3](#3-getting-the-machine-to-actually-boot-it).

Reach for **Rufus** when you need control over the layout, or as an A/B test when
a machine refuses to boot the MCT stick.

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

That message means *the machine reading it* can't parse the USB's filesystem.
Which end is at fault depends on how the stick was made:

- Written in **image/dd mode** (Etcher, `dd`, Rufus DD mode) — the stick is at
  fault. That layout is ISO9660/UDF, which Windows cannot mount.
- Written **GPT** on a *removable* flash drive — Windows 7 only exposes the first
  partition of removable media and handles GPT on it badly.
- **Failing or counterfeit flash.** Faked-capacity sticks are common.
- **The reading machine is at fault.** A heavily stripped vendor image can have a
  damaged USB storage or filesystem stack and fail to mount a perfectly good
  FAT32 stick. If the same image is also missing PowerShell, assume this before
  blaming the stick.

Prove which it is before rebuilding anything — see below.

### Prove the stick before blaming the BIOS

Plug the stick into a **known-good PC**. Two checks, in order:

1. **Does it open?** You should see `setup.exe`, `bootmgr`, `boot\`, `efi\boot\`
   and `sources\`. `efi\boot\bootx64.efi` is the file UEFI needs;
   `sources\install.wim` or `install.esd` is the payload.
2. **Does it boot?** Boot that PC from it and stop at the "Install now" screen,
   then power off. Nothing is written to the PC.

If it boots on another machine, the stick is proven good and the problem is
entirely the till's firmware. Skip any rebuild and work through step 3.

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
   and a plain `<name>` (legacy). Try both — they are different boot paths and
   one failing says nothing about the other. A Media Creation Tool stick is
   FAT32, so the `UEFI:` entry is the cleaner path on that media; a Rufus
   MBR/NTFS stick generally does better on the plain legacy entry.
6. **Disable Secure Boot** if the firmware has it.
7. **Check the `Boot Option Filter` / CSM sub-settings.** Some firmware sets
   storage devices to "UEFI only" or "Legacy only" independently of the global
   CSM switch, which silently hides one of the two entries above.
8. **32-bit UEFI firmware.** Some Bay Trail / Atom POS boards ship a 32-bit UEFI
   even with a 64-bit CPU. A 64-bit installer has no `bootia32.efi`, so the UEFI
   path is a no-op — the legacy entry is the only one that will work. Check the
   survey's CPU `AddressWidth` and the OS architecture.

## 3a. Errors at the "Where do you want to install Windows?" screen

Two errors show up together on a vendor-imaged till, and they share a cause: the
disk is still laid out for the old install, and it does not match the mode you
booted Setup in.

> **"Windows cannot be installed to this disk. The selected disk has an MBR
> partition table. On EFI systems, Windows can only be installed to GPT disks."**

You booted the USB via its **UEFI** entry, but the internal disk is **MBR** from
the vendor's Windows 7. Either convert the disk to GPT (below), or reboot and
pick the **legacy** USB entry instead to stay on MBR.

> **"We couldn't format the selected partition. [Error: 0x8004242d]"**

Setup can't reuse the existing partition. Don't fight it — wipe the disk and let
Setup lay it out from scratch.

### First: rescue the vendor's driver partition

Chinese POS vendors routinely ship drivers on a **second partition** of the
internal disk rather than on any external media, and it is often the only copy in
existence. Wiping the disk destroys it. Check for it before doing anything
destructive.

From `Shift+F10` at the partition screen:

```cmd
diskpart
list volume
exit
```

Read the **Size** column — the large volume is Windows, a few-GB volume alongside
it is usually the driver partition. WinPE assigns its own drive letters, so they
will not match what Windows 7 showed. Confirm with `dir E:\` before trusting a
letter.

Plug in a **second** USB stick, leave the install media alone, and copy:

```cmd
robocopy E:\ F:\till-drivers /E /R:1 /W:1 /XJ
dir F:\till-drivers /s | more
```

Verify the copy before wiping anything.

These are Windows 7 drivers, so some will not install on Windows 10 — keep them
anyway. The `.inf` files identify the exact hardware, which is usually the
fastest route to the correct Windows 10 driver even when the binaries are
useless.

### Keeping the driver partition in place

The whole-disk wipe is only needed because MBR → GPT conversion requires an empty
disk. Reboot on the USB's **legacy** entry instead and no conversion is needed:
delete only the Windows partition, install into that space, and the driver
partition survives untouched.

The cost is staying on MBR, which rules out a later Windows 11 upgrade.
Acceptable for a till, but copying the drivers to a USB stick and going GPT is
the better end state — drivers stored on the machine they belong to are one disk
failure from gone.

### Fix: wipe and convert with diskpart

At the partition screen press `Shift+F10` for a command prompt:

```cmd
diskpart
list disk
```

**Read the sizes and identify the internal disk before going further.** POS
machines often have a multi-slot card reader that enumerates as several removable
disks, plus the install USB itself — so `Disk 0` is not automatically the right
target. Match on capacity.

```cmd
select disk 0
clean
convert gpt
exit
exit
```

Then **Refresh** on the partition screen, select the single block of unallocated
space, and press **Next**. Setup creates the EFI system partition, MSR and
primary partition itself — do not create them by hand.

Omit `convert gpt` if you deliberately booted legacy and want to stay MBR.

> `clean` erases the whole disk immediately and without confirmation, including
> the vendor's Windows. Make sure the disk image from step 1 exists first, and
> that you selected the right disk.

### While you have the prompt open

`Shift+F10` in Setup is also the reliable place to read the firmware OEM key,
which Windows 7 cannot report:

```cmd
wmic path softwarelicensingservice get OA3xOriginalProductKey
```

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

## 4a. Which edition, and how you will reach the till remotely

**Install Pro, not Home.** Windows 10/11 **Home cannot host a Remote Desktop
session** — it can only connect out. If remote access matters, the edition is
decided at purchase time and is expensive to get wrong.

That said, **RDP is a poor fit for a till.** Desktop Windows is single-session:
an incoming RDP connection *locks the physical console*. Connecting to help a
cashier kicks them off mid-transaction, and you cannot see the screen they are
describing.

For POS support use **console mirroring** instead — RustDesk (free, open source,
self-hostable), AnyDesk or TeamViewer. These attach to the live session, so the
cashier keeps working while you watch.

Note this cuts both ways: those tools run on Windows 7 too, so remote access on
its own is not a reason to reinstall. The reasons that hold are the stripped
image, Chrome being frozen at 109, and PowerShell being absent — a till without
PowerShell cannot run `start-pos-mode.ps1` and therefore cannot run POS mode at
all.

## 5. After the install

1. Windows Update, then the peripheral drivers you collected in step 1.
2. Check Device Manager for anything unresolved — or re-run the survey and read
   its *Devices with a driver problem* section.
3. Install Chrome.
4. Install the remote-support client (see [4a](#4a-which-edition-and-how-you-will-reach-the-till-remotely))
   before the till leaves your bench — it is what saves a site visit later.
5. `setup-pos-pc.bat` — installs the KPay daemon as a service.
6. `start-pos-mode.ps1` — configure `$PosUrl`, then set up auto-start.
7. Set the customer-facing screen as the Windows **secondary** monitor, or set
   `$SwapMonitors = $true`.

Once every till is on Windows 10+, two pins can be lifted: the Go 1.20 toolchain
on `kpay-daemon` (see [WINDOWS_SETUP.md](../../services/kpay-daemon/WINDOWS_SETUP.md))
and the PowerShell 2.0 constraint on the scripts in this folder.

## Licensing

Read [the OEM key section](README.md#reading-the-oem-key-on-a-windows-7-machine)
before buying anything — if the machine carries a firmware OEM licence, a clean
install self-activates and there is no key to buy.

Windows also installs and runs **unactivated** indefinitely — skip the key prompt
with "I don't have a product key". Security updates, drivers, Chrome, the KPay
daemon and the kiosk launcher all work. The restrictions are cosmetic: an
"Activate Windows" watermark and greyed-out Personalisation settings.

Use that to get a till into service while a licence is sorted out — you are not
blocked on the key. **It is a bridge, not a plan:** unactivated is not the same
as licensed, and running a business on unlicensed Windows carries the same
exposure as a grey-market key.

There is also a practical reason not to leave a till this way: the watermark
renders on the **customer-facing display**, in the corner of the screen customers
watch while paying.
