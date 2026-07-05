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

/** Fixed bill reference for manual PayNow fallback payments. */
export const MANUAL_PAYNOW_REFERENCE = 'POS-MNL-QR';
