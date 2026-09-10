// Dynamic PayNow QR payload (EMVCo / SGQR format).
//
// Encodes the exact amount and a fixed bill reference so the customer cannot
// mistype the amount when the KPay terminal is offline and the POS falls back
// to manual PayNow. The payload is plain text rendered as a QR code
// client-side — no bank API involved.

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the payload, per EMVCo. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface PayNowQrOptions {
  uen: string;
  amount: number;
  merchantName: string;
  reference: string;
  editable?: boolean;
}

export function buildPayNowPayload({ uen, amount, merchantName, reference, editable = false }: PayNowQrOptions): string {
  const merchantAccount = tlv('26', [
    tlv('00', 'SG.PAYNOW'),
    tlv('01', '2'), // proxy type 2 = UEN
    tlv('02', uen.toUpperCase()),
    tlv('03', editable ? '1' : '0'),
  ].join(''));

  const body = [
    tlv('00', '01'), // payload format indicator
    tlv('01', '12'), // dynamic QR (one transaction)
    merchantAccount,
    tlv('52', '0000'), // merchant category: unspecified
    tlv('53', '702'), // SGD
    tlv('54', amount.toFixed(2)),
    tlv('58', 'SG'),
    tlv('59', merchantName.slice(0, 25) || 'NA'),
    tlv('60', 'Singapore'),
    tlv('62', tlv('01', reference.slice(0, 25))),
  ].join('');

  const withCrcId = `${body}6304`;
  return `${withCrcId}${crc16ccitt(withCrcId)}`;
}

/** Legacy fallback when a checkout key cannot provide a transaction token. */
export const MANUAL_PAYNOW_REFERENCE = 'POS-MNL-QR';

/**
 * Build a bank-statement-friendly reference that identifies both the outlet and
 * checkout. PayNow bill references are capped at 25 characters; keeping each
 * component short and using twelve checkout hex characters produces references
 * such as `TAMP-B29FC9CAADE6` while remaining stable for the life of the checkout.
 */
export function derivePayNowReference(outletName?: string | null, checkoutKey?: string | null): string {
  const normalizedOutlet = (outletName || '')
    .trim()
    .replace(/^HAC[\s_-]+/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  const outletWords = normalizedOutlet.split('-').filter(Boolean);
  const outletCode = outletWords.length > 1
    ? outletWords.map((word) => word[0]).join('').slice(0, 4)
    : (outletWords[0] || 'POS').slice(0, 4);
  const checkoutToken = (checkoutKey || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);

  if (checkoutToken.length !== 12) {
    return MANUAL_PAYNOW_REFERENCE;
  }
  return `${outletCode}-${checkoutToken}`;
}
