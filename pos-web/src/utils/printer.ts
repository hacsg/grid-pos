// Receipt printer helper built on WebUSB.
//
// WebUSB device permission persists per-origin: once the user has granted a
// device via requestDevice(), it reappears in getDevices() on later visits with
// no prompt. So we pick a previously-granted device first and only prompt when
// nothing has been granted yet — then remember it for next time.

const PRINTER_KEY = 'grid_pos_printer';

export interface SavedPrinter {
  vendorId: number;
  productId: number;
  name: string;
}

function usbApi(): any | null {
  return (navigator as Navigator & { usb?: any }).usb ?? null;
}

export function isPrintingSupported(): boolean {
  return Boolean(usbApi());
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

/** Prompt the user to pick a printer once, and remember it. */
export async function connectPrinter(): Promise<SavedPrinter> {
  const usb = usbApi();
  if (!usb) {
    throw new Error('Receipt printing needs Chrome/Edge over HTTPS (WebUSB).');
  }
  const device = await usb.requestDevice({ filters: [{ classCode: 7 }] });
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

async function sendToDevice(device: any, text: string): Promise<void> {
  await device.open();
  if (!device.configuration) {
    await device.selectConfiguration(1);
  }
  const iface = device.configuration.interfaces.find((i: any) =>
    i.alternates.some((a: any) => a.endpoints.some((e: any) => e.direction === 'out'))
  );
  const alternate = iface?.alternates.find((a: any) => a.endpoints.some((e: any) => e.direction === 'out'));
  const endpoint = alternate?.endpoints.find((e: any) => e.direction === 'out');
  if (!iface || !endpoint) {
    await device.close();
    throw new Error('No printable USB interface');
  }
  await device.claimInterface(iface.interfaceNumber);
  const payload = new TextEncoder().encode(`${text}\n\n\x1dV\x00`);
  await device.transferOut(endpoint.endpointNumber, payload);
  await device.releaseInterface(iface.interfaceNumber);
  await device.close();
}

/**
 * Print receipt text. Uses the saved/previously-granted printer without
 * prompting; only prompts (once) if no device has been granted yet.
 * Returns true on success.
 */
export async function printReceipt(text: string): Promise<boolean> {
  const usb = usbApi();
  if (!usb) {
    return false;
  }
  try {
    let device = await resolveGrantedDevice();
    if (!device) {
      device = await usb.requestDevice({ filters: [{ classCode: 7 }] });
      rememberPrinter(device);
    }
    await sendToDevice(device, text);
    return true;
  } catch {
    return false;
  }
}
