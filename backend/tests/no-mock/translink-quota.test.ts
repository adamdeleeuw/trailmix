import { TranslinkQuotaModel } from '../../src/models/translink-quota.model';
import { DAILY_REQUEST_CAP, pacificDay, reserveTranslinkRequest, translinkRequestsOn } from '../../src/services/translink-quota';
import { useTestDatabase } from '../helpers/db';

// The daily TransLink request cap, against the real test database
useTestDatabase();

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pacificDay', () => {
  // Input: explicit UTC moments either side of 07:00Z in winter and summer
  // Expected output: the Pacific date, which changes at 07:00 UTC all year (B.C.'s permanent UTC-7), not UTC midnight
  // nor 08:00 UTC, whatever the machine's time zone database says
  test('uses the date in Vancouver', () => {
    expect(pacificDay(new Date('2026-11-18T06:59:59Z'))).toBe('2026-11-17');
    expect(pacificDay(new Date('2026-11-18T07:00:00Z'))).toBe('2026-11-18');
    expect(pacificDay(new Date('2026-11-18T07:59:59Z'))).toBe('2026-11-18');
    expect(pacificDay(new Date('2027-01-15T06:59:59Z'))).toBe('2027-01-14');
    expect(pacificDay(new Date('2027-01-15T07:00:00Z'))).toBe('2027-01-15');
    expect(pacificDay(new Date('2026-07-01T06:59:59Z'))).toBe('2026-06-30');
    expect(pacificDay(new Date('2026-07-01T07:00:00Z'))).toBe('2026-07-01');
  });
});

describe('reserveTranslinkRequest', () => {
  const NOON = new Date('2026-11-18T20:00:00Z');

  // Input: the cap's worth of requests on one day, then one more, racing in parallel
  // Expected behavior: exactly DAILY_REQUEST_CAP are allowed, and the count stops there
  test('allows exactly the cap, even when requests race', async () => {
    await TranslinkQuotaModel.create({ _id: pacificDay(NOON), count: DAILY_REQUEST_CAP - 10 });

    const allowed = await Promise.all(Array.from({ length: 15 }, () => reserveTranslinkRequest(NOON)));

    expect(allowed.filter(Boolean)).toHaveLength(10);
    expect(await translinkRequestsOn(NOON)).toBe(DAILY_REQUEST_CAP);
  });

  // Input: the first requests of a day, racing, so their upserts collide
  // Expected behavior: every one is allowed and counted
  test('counts racing first requests of a day', async () => {
    const allowed = await Promise.all(Array.from({ length: 5 }, () => reserveTranslinkRequest(NOON)));

    expect(allowed).toStrictEqual([true, true, true, true, true]);
    expect(await translinkRequestsOn(NOON)).toBe(5);
  });

  // Input: a capped day, then the first moment of the next Pacific day
  // Expected behavior: the new day starts its own count at 1, and the first request is logged
  test('resets at midnight Pacific', async () => {
    await TranslinkQuotaModel.create({ _id: '2026-11-18', count: DAILY_REQUEST_CAP });
    const log = jest.spyOn(console, 'log');

    expect(await reserveTranslinkRequest(new Date('2026-11-19T06:59:00Z'))).toBe(false);
    expect(await reserveTranslinkRequest(new Date('2026-11-19T07:00:00Z'))).toBe(true);
    expect(await translinkRequestsOn(new Date('2026-11-19T07:00:00Z'))).toBe(1);
    expect(log).toHaveBeenCalledWith(`TransLink requests on 2026-11-19 (Pacific): 1/${DAILY_REQUEST_CAP}`);
  });

  // Input: a day with no requests
  // Expected output: a count of 0
  test('counts 0 for a new day', async () => {
    expect(await translinkRequestsOn(NOON)).toBe(0);
  });
});
