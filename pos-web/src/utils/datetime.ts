/**
 * Grid displays every time in Singapore time.
 *
 * `toLocaleString('en-SG')` looks like it does this, but `en-SG` is a *locale*
 * — it picks the formatting conventions and nothing else. Without an explicit
 * `timeZone` the value is rendered in whatever zone the viewing machine is set
 * to, so the same order reads differently on the till and on a laptop abroad.
 * Pass SGT_TIME_ZONE (or use the helpers) on every call.
 */

export const SGT_TIME_ZONE = 'Asia/Singapore';
const SGT_LOCALE = 'en-SG';

/** Parse an API timestamp, falling back to now when absent or unparseable. */
export function parseTimestamp(value?: string | null): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Date and time in SGT, e.g. "7/8/2026, 7:23:00 pm". */
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
