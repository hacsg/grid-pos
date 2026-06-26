export const DISPLAY_CHANNEL = 'grid-pos-display';

export interface DisplayItem {
  name: string;
  quantity: number;
  lineTotal: number;
  modifiers: string[];
}

export interface OrderSnapshot {
  items: DisplayItem[];
  subtotal: number;
  discount: number;
  loyaltyDiscount: number;
  voucherDiscount: number;
  total: number;
  loyaltyCustomerName?: string;
  brandName?: string;
  brandLogoUrl?: string | null;
}

export type DisplayMessage =
  | { type: 'ORDER_UPDATE'; payload: OrderSnapshot }
  | { type: 'PAYMENT_START'; payload: { total: number } }
  // Sent when the cashier exits checkout without completing payment, so the
  // display drops the "Processing payment…" screen instead of staying stuck.
  | { type: 'PAYMENT_CANCEL' }
  | { type: 'PAYNOW_QR'; payload: { qrUrl: string; total: number } }
  | { type: 'PAYMENT_COMPLETE'; payload: { total: number; pointsEarned?: number | null } }
  | { type: 'ORDER_COMPLETE' }
  // Sent by the customer display on load so the POS re-broadcasts current state
  // (so the idle/welcome screen shows branding even if opened mid-session).
  | { type: 'DISPLAY_HELLO' };

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(DISPLAY_CHANNEL);
    } catch {
      return null;
    }
  }
  return channel;
}

export function broadcast(msg: DisplayMessage): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage(msg);
  } catch {
    // BroadcastChannel unavailable or closed; ignore silently
  }
}

export function closeDisplayChannel(): void {
  if (channel) {
    try {
      channel.close();
    } catch {
      // ignore
    }
    channel = null;
  }
}
