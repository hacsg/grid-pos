import { describe, expect, it } from 'vitest';
import { formatSgtDateTime, formatSgtTime } from './datetime';
import { formatReceiptTime } from './receipt';

// 2026-08-07T11:23:00Z is 19:23 in Singapore. These assertions only hold if the
// formatter pins the zone: run under TZ=UTC (see the npm script) they fail for
// any call that relies on the machine's local zone, which is what the receipt
// helpers used to do.
const UTC_INSTANT = '2026-08-07T11:23:00.000Z';

describe('SGT formatting is independent of the machine timezone', () => {
  it('renders time of day in Singapore time', () => {
    expect(formatSgtTime(UTC_INSTANT)).toBe('19:23');
  });

  it('renders date and time in Singapore time', () => {
    const formatted = formatSgtDateTime(UTC_INSTANT);
    expect(formatted).toContain('7:23');
    expect(formatted).not.toContain('11:23');
  });

  it('rolls the date forward when SGT is already the next day', () => {
    // 20:00 UTC on the 7th is 04:00 on the 8th in Singapore.
    expect(formatSgtDateTime('2026-08-07T20:00:00.000Z')).toContain('08/08/2026');
  });

  it('formats receipt times in Singapore time', () => {
    expect(formatReceiptTime(UTC_INSTANT)).toContain('7:23');
  });
});
