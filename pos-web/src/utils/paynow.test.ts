import { describe, expect, it } from 'vitest';
import {
  buildPayNowPayload,
  crc16ccitt,
  derivePayNowReference,
  MANUAL_PAYNOW_REFERENCE,
} from './paynow';

const CHECKOUT_KEY = 'b29fc9ca-ade6-4869-bb36-0db319092343';

describe('derivePayNowReference', () => {
  it.each([
    ['HAC Tampines', 'TAMP-B29FC9CAADE6'],
    ['HAC Sunset Way', 'SW-B29FC9CAADE6'],
    ['HAC SSC', 'SSC-B29FC9CAADE6'],
    ['HAC Bedok', 'BEDO-B29FC9CAADE6'],
  ])('uses a concise outlet code for %s', (outletName, expected) => {
    expect(derivePayNowReference(outletName, CHECKOUT_KEY)).toBe(expected);
  });

  it('normalizes outlet names to bank-safe uppercase characters', () => {
    expect(derivePayNowReference(' HAC Sunset Way! ', CHECKOUT_KEY)).toBe('SW-B29FC9CAADE6');
  });

  it('uses a safe POS prefix when the outlet name is blank', () => {
    expect(derivePayNowReference(' ', CHECKOUT_KEY)).toBe('POS-B29FC9CAADE6');
  });

  it('falls back to the legacy reference when no valid checkout token exists', () => {
    expect(derivePayNowReference('HAC Tampines', 'not-a-uuid')).toBe(MANUAL_PAYNOW_REFERENCE);
  });

  it('never exceeds the PayNow reference limit', () => {
    const reference = derivePayNowReference('HAC An Extremely Long Outlet Name', CHECKOUT_KEY);
    expect(reference).toMatch(/^[A-Z0-9-]+$/);
    expect(reference.length).toBeLessThanOrEqual(25);
  });
});

describe('buildPayNowPayload', () => {
  it('encodes the Tampines UEN, exact amount, transaction reference, and CRC', () => {
    const payload = buildPayNowPayload({
      uen: '202031206N',
      amount: 12.34,
      merchantName: 'HAC Tampines',
      reference: derivePayNowReference('HAC Tampines', CHECKOUT_KEY),
    });

    expect(payload).toBe(
      '00020101021226370009SG.PAYNOW010120210202031206N03010520400005303702540512.345802SG5912HAC Tampines6009Singapore62210117TAMP-B29FC9CAADE663048355',
    );
    expect(payload.slice(-4)).toBe(crc16ccitt(payload.slice(0, -4)));
  });
});
