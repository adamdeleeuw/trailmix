/**
 * Calendar days in B.C., without trusting the runtime's time zone database.
 *
 * @remarks
 * B.C. moved to permanent daylight time in 2026: a fixed UTC-7 all year, with no fall-back on Nov 1. Node's tzdata
 * only knows this from some release on, so `Intl` with "America/Vancouver" gives UTC-7 on one machine and UTC-8 on
 * another in winter (our CI and dev machines disagreed). B.C.'s days are computed with {@link BC_UTC_OFFSET_HOURS}
 * instead, so they're the same everywhere.
 */

/** B.C.'s offset from UTC, all year, since its permanent daylight time in 2026. */
export const BC_UTC_OFFSET_HOURS = -7;
const MS_PER_HOUR = 3_600_000;

// IANA names for B.C.'s time, as Intl resolves them ("Canada/Pacific" resolves to "America/Vancouver")
const BC_TIME_ZONES = new Set(['America/Vancouver']);

/** The day a moment falls on in B.C., as YYYY-MM-DD. */
export function bcDay(at: Date): string {
  return new Date(at.getTime() + BC_UTC_OFFSET_HOURS * MS_PER_HOUR).toISOString().slice(0, 10);
}

/**
 * The day a moment falls on in time zone `timezone`, as YYYY-MM-DD.
 *
 * @remarks
 * B.C.'s zone uses {@link bcDay}; other zones use the runtime's time zone database.
 *
 * @param timezone - An IANA name, like the profile's.
 * @throws RangeError for a name that isn't a time zone.
 */
export function localDay(at: Date, timezone: string): string {
  const resolved = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).resolvedOptions().timeZone;
  if (BC_TIME_ZONES.has(resolved)) return bcDay(at);
  // en-CA formats dates as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
