// Receipt printer helper built on WebUSB.
//
// WebUSB device permission persists per-origin: once the user has granted a
// device via requestDevice(), it reappears in getDevices() on later visits with
// no prompt. So we pick a previously-granted device first and only prompt when
// nothing has been granted yet — then remember it for next time.

const PRINTER_KEY = 'grid_pos_printer';
const DRAWER_PIN_KEY = 'grid_pos_drawer_pin';

const PRINTER_INTERFACE_CLASSES = [7, 0xff];

export interface SavedPrinter {
  vendorId: number;
  productId: number;
  name: string;
}

export interface ConnectPrinterOptions {
  /** When true, show every USB device in the picker (not just class 7 printers). */
  allDevices?: boolean;
}

/** Replace non-ASCII characters so ESC/POS default codepage does not garble output. */
export function sanitizeAscii(text: string): string {
  return text.replace(/[^\x20-\x7E\n\r\t]/g, '?');
}

/** ESC @ init + sanitized text + feed + GS V 0 full cut. */
export function buildPrintPayload(text: string): Uint8Array {
  const sanitized = sanitizeAscii(text);
  const init = new Uint8Array([0x1b, 0x40]);
  const body = new TextEncoder().encode(`${sanitized}\n\n\n\n`);
  const cut = new Uint8Array([0x1d, 0x56, 0x00]);
  const payload = new Uint8Array(init.length + body.length + cut.length);
  payload.set(init, 0);
  payload.set(body, init.length);
  payload.set(cut, init.length + body.length);
  return payload;
}

/** ESC p <pin> 25 250 — pulse the RJ11 drawer port on the receipt printer. */
export function buildDrawerPulsePayload(pin: 0 | 1 = 0): Uint8Array {
  return new Uint8Array([0x1b, 0x70, pin, 0x19, 0xfa]);
}

export function drawerPinFromStorage(): 0 | 1 {
  try {
    return localStorage.getItem(DRAWER_PIN_KEY) === '1' ? 1 : 0;
  } catch {
    return 0;
  }
}

function usbApi(): any | null {
  return (navigator as Navigator & { usb?: any }).usb ?? null;
}

// Local print service exposed by the KPay daemon on the POS PC — the fallback
// for built-in printers WebUSB cannot see (internal serial wiring). It prints
// through the Windows driver, so no browser device grant is needed.
const PRINT_SERVICE_URL = 'http://127.0.0.1:9123';

async function localServicePost(path: string, body?: unknown): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${PRINT_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (!response.ok) {
      return false;
    }
    const data = await response.json().catch(() => null);
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

export function isPrintingSupported(): boolean {
  // WebUSB may be absent (or unable to see the printer) and printing can still
  // work through the local print service, so always offer the print controls;
  // failures surface as toasts.
  return true;
}

export function getSavedPrinter(): SavedPrinter | null {
  try {
    const raw = localStorage.getItem(PRINTER_KEY);
    return raw ? (JSON.parse(raw) as SavedPrinter) : null;
  } catch {
    return null;
  }
}

export function forgetPrinter(): void {
  localStorage.removeItem(PRINTER_KEY);
}

function rememberPrinter(device: any): SavedPrinter {
  const saved: SavedPrinter = {
    vendorId: device.vendorId,
    productId: device.productId,
    name: device.productName || `USB ${device.vendorId}:${device.productId}`,
  };
  localStorage.setItem(PRINTER_KEY, JSON.stringify(saved));
  return saved;
}

function interfaceScore(iface: any): number {
  for (const alternate of iface.alternates) {
    const hasOut = alternate.endpoints.some((endpoint: any) => endpoint.direction === 'out');
    if (!hasOut) {
      continue;
    }
    if (PRINTER_INTERFACE_CLASSES.includes(alternate.interfaceClass)) {
      return 2;
    }
    return 1;
  }
  return 0;
}

function findPrintableInterface(device: any): {
  iface: any;
  alternate: any;
  endpoint: any;
} | null {
  const ranked = [...device.configuration.interfaces]
    .map((iface: any) => ({ iface, score: interfaceScore(iface) }))
    .filter((entry: { score: number }) => entry.score > 0)
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

  for (const { iface } of ranked) {
    const alternate = iface.alternates.find((alt: any) =>
      alt.endpoints.some((endpoint: any) => endpoint.direction === 'out')
    );
    const endpoint = alternate?.endpoints.find((ep: any) => ep.direction === 'out');
    if (iface && alternate && endpoint) {
      return { iface, alternate, endpoint };
    }
  }
  return null;
}

async function requestPrinterDevice(usb: any, options?: ConnectPrinterOptions): Promise<any> {
  const filters = options?.allDevices ? [] : [{ classCode: 7 }];
  return usb.requestDevice({ filters });
}

/** Prompt the user to pick a printer once, and remember it. */
export async function connectPrinter(options?: ConnectPrinterOptions): Promise<SavedPrinter> {
  const usb = usbApi();
  if (!usb) {
    throw new Error('Receipt printing needs Chrome/Edge over HTTPS (WebUSB).');
  }
  const device = await requestPrinterDevice(usb, options);
  return rememberPrinter(device);
}

async function resolveGrantedDevice(): Promise<any | null> {
  const usb = usbApi();
  if (!usb) {
    return null;
  }
  const devices: any[] = await usb.getDevices();
  if (devices.length === 0) {
    return null;
  }
  const saved = getSavedPrinter();
  if (saved) {
    const match = devices.find((d) => d.vendorId === saved.vendorId && d.productId === saved.productId);
    if (match) {
      return match;
    }
  }
  return devices[0];
}

async function sendBytes(device: any, payload: Uint8Array): Promise<void> {
  await device.open();
  if (!device.configuration) {
    await device.selectConfiguration(1);
  }
  const printable = findPrintableInterface(device);
  if (!printable) {
    await device.close();
    throw new Error('No printable USB interface');
  }
  const { iface, endpoint } = printable;
  await device.claimInterface(iface.interfaceNumber);
  await device.transferOut(endpoint.endpointNumber, payload);
  await device.releaseInterface(iface.interfaceNumber);
  await device.close();
}

let printInFlight = false;

// Send via a previously-granted WebUSB device only — no picker prompt here.
// Prompting stays in the explicit connect flow; print/drawer calls fall back
// to the local print service instead of surprising the cashier with a picker.
async function sendPayloadOverUsb(payload: Uint8Array): Promise<boolean> {
  try {
    const device = await resolveGrantedDevice();
    if (!device) {
      return false;
    }
    await sendBytes(device, payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Print receipt text: granted WebUSB printer first, then the daemon's local
 * print service (Windows driver). Returns true on success.
 */
export async function printReceipt(text: string): Promise<boolean> {
  if (printInFlight) {
    return false;
  }
  printInFlight = true;
  try {
    if (await sendPayloadOverUsb(buildPrintPayload(text))) {
      return true;
    }
    return await localServicePost('/print', { text: sanitizeAscii(text) });
  } finally {
    printInFlight = false;
  }
}

/** Pulse the cash drawer connected to the receipt printer. Returns true on success. */
export async function openCashDrawer(pin: 0 | 1 = drawerPinFromStorage()): Promise<boolean> {
  if (await sendPayloadOverUsb(buildDrawerPulsePayload(pin))) {
    return true;
  }
  return localServicePost('/drawer');
}