import { BC_UTC_OFFSET_HOURS, bcDay, localDay } from '../../src/services/bc-time';

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
