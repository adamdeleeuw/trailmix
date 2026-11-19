import { BC_UTC_OFFSET_HOURS, bcDay, bcMonth, localDay, nextBcMidnight, nextBcMonth } from '../../src/services/bc-time';

// B.C.'s days at a fixed UTC-7, independent of the runtime's time zone database

describe('bcDay', () => {
  // Input: explicit UTC moments around 07:00Z, in winter and summer
  // Expected output: the B.C. date, which changes at 07:00 UTC all year
  test('changes at 07:00 UTC all year', () => {
    expect(BC_UTC_OFFSET_HOURS).toBe(-7);
    expect(bcDay(new Date('2026-11-18T06:59:59.999Z'))).toBe('2026-11-17');
    expect(bcDay(new Date('2026-11-18T07:00:00Z'))).toBe('2026-11-18');
    expect(bcDay(new Date('2026-07-01T06:59:59Z'))).toBe('2026-06-30');
    expect(bcDay(new Date('2026-07-01T07:00:00Z'))).toBe('2026-07-01');
  });
});

describe('localDay', () => {
  // Input: B.C.'s zone by its name and an alias, at 07:30Z in winter, when old tzdata would say it's still yesterday
  // Expected output: the B.C. date at UTC-7
  test("uses the fixed offset for B.C.'s zone", () => {
    expect(localDay(new Date('2026-11-18T07:30:00Z'), 'America/Vancouver')).toBe('2026-11-18');
    expect(localDay(new Date('2026-11-18T07:30:00Z'), 'Canada/Pacific')).toBe('2026-11-18');
    expect(localDay(new Date('2026-11-18T06:30:00Z'), 'America/Vancouver')).toBe('2026-11-17');
  });

  // Input: zones outside B.C. that don't move with daylight time
  // Expected output: their own date, from the runtime's database
  test('uses the runtime for other zones', () => {
    expect(localDay(new Date('2026-11-18T07:30:00Z'), 'UTC')).toBe('2026-11-18');
    expect(localDay(new Date('2026-11-18T03:30:00Z'), 'Asia/Tokyo')).toBe('2026-11-18');
    expect(localDay(new Date('2026-11-18T03:30:00Z'), 'Asia/Kolkata')).toBe('2026-11-18');
    expect(localDay(new Date('2026-11-17T23:30:00Z'), 'Asia/Kolkata')).toBe('2026-11-18');
  });

  // Input: a name that isn't a time zone
  // Expected behavior: a RangeError, as from Intl
  test('rejects an unknown zone', () => {
    expect(() => localDay(new Date('2026-11-18T07:30:00Z'), 'Mars/Olympus')).toThrow(RangeError);
  });
});

// issue #89: the daily and monthly plan limits reset at midnight in B.C.
describe('B.C. midnights', () => {
  // Input: moments just before and just after 07:00Z, B.C.'s midnight
  // Expected output: the next midnight is 07:00Z the following day, or later the same UTC day before 07:00Z
  test('finds the next midnight at 07:00 UTC', () => {
    expect(nextBcMidnight(new Date('2026-11-18T19:00:00Z'))).toEqual(new Date('2026-11-19T07:00:00Z'));
    expect(nextBcMidnight(new Date('2026-11-18T06:59:59Z'))).toEqual(new Date('2026-11-18T07:00:00Z'));
    expect(nextBcMidnight(new Date('2026-11-18T07:00:00Z'))).toEqual(new Date('2026-11-19T07:00:00Z'));
  });

  // Input: moments in November, on New Year's Eve in B.C., and just after 2027 starts in B.C.
  // Expected output: the B.C. month, and midnight in B.C. on the 1st of the next month, rolling over the year
  test('finds the month and the next 1st of the month', () => {
    expect(bcMonth(new Date('2026-12-01T06:59:59Z'))).toBe('2026-11');
    expect(nextBcMonth(new Date('2026-11-18T19:00:00Z'))).toEqual(new Date('2026-12-01T07:00:00Z'));
    expect(nextBcMonth(new Date('2027-01-01T06:59:59Z'))).toEqual(new Date('2027-01-01T07:00:00Z'));
    expect(nextBcMonth(new Date('2027-01-01T07:00:00Z'))).toEqual(new Date('2027-02-01T07:00:00Z'));
  });
});
