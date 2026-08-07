/**
 * Admin displays every time in Singapore time.
 *
 * `toLocaleString('en-SG')` sets the formatting conventions, not the zone —
 * without an explicit `timeZone` the value renders in the viewer's zone, so a
 * receipt preview would disagree with the receipt the till actually prints.
 */

export const SGT_TIME_ZONE = 'Asia/Singapore';
const SGT_LOCALE = 'en-SG';

function parseTimestamp(value?: string | null): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Date and time in SGT. */
export function formatSgtDateTime(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return parseTimestamp(value).toLocaleString(SGT_LOCALE, {
    timeZone: SGT_TIME_ZONE,
    ...options,
  });
}

/** Time of day in SGT. Defaults to 24-hour "19:23". */
export function formatSgtTime(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false },
): string {
  return parseTimestamp(value).toLocaleTimeString(SGT_LOCALE, {
    timeZone: SGT_TIME_ZONE,
    ...options,
  });
}

/** Calendar date in SGT. */
export function formatSgtDate(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return parseTimestamp(value).toLocaleDateString(SGT_LOCALE, {
    timeZone: SGT_TIME_ZONE,
    ...options,
  });
}
