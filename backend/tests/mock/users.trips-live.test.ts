import request from 'supertest';
import { createApp } from '../../src/app';
import { TranslinkQuotaModel } from '../../src/models/translink-quota.model';
import { TripModel } from '../../src/models/trip.model';
import { liveFeeds } from '../../src/services/live-feeds';
import { DAILY_REQUEST_CAP, pacificDay } from '../../src/services/translink-quota';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { feedBytes } from '../helpers/gtfs-rt';
import {
  bus99Feed, busThenWalkLegs, createLiveTrip, detourFeed, fakeTranslink, FAKE_TRANSLINK_KEY, type FakeAnswer,
} from '../helpers/live';

// Interface: GET /api/users/me/trips/:id/live, with TransLink faked by mocking fetch
useTestDatabase();

const app = createApp();
const DELAY = 180;

let logged: string[];

beforeEach(() => {
  process.env.TRANSLINK_API_KEY = FAKE_TRANSLINK_KEY;
  logged = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : String(arg)).join(' '));
    });
  }
});

afterEach(() => {
  liveFeeds.reset();
  jest.restoreAllMocks();
  process.env.TRANSLINK_API_KEY = '';
});

/** A signed-in user with an active trip that boards the 99 in 10 minutes, then walks. */
async function activeBusTrip() {
  const { user, token } = await createSignedInUser();
  const departAt = new Date(Date.now() + 10 * 60_000);
  const trip = await createLiveTrip(user._id, busThenWalkLegs(departAt));
  return { token, departAt, tripId: trip._id.toHexString() };
}

/** Fake TransLink answering with the 99 running late and a detour, unless a feed's answer is overridden. */
function translink(departAt: Date, overrides: { tripUpdates?: () => FakeAnswer; alerts?: () => FakeAnswer } = {}) {
  const now = () => Math.floor(Date.now() / 1000);
  return fakeTranslink((kind) => {
    const override = overrides[kind];
    if (override !== undefined) return override();
    return kind === 'tripUpdates' ? bus99Feed(now(), departAt, DELAY) : detourFeed(now(), now() + 7200);
  });
}

const getLive = (tripId: string, token: string, query = '') =>
  request(app).get(`/api/users/me/trips/${tripId}/live${query}`).set('Authorization', bearer(token));

describe('Mocked: GET /api/users/me/trips/:id/live', () => {
  // Mocked behavior: TransLink sends a trip updates feed with the planned 99 run 3 minutes late (by trip_id only)
  //                  and an alerts feed with a detour on the 99 and one on another route
  // Input: the active trip, on its first leg
  // Expected status code: 200
  // Expected behavior: both feeds are fetched once, with the key; the leg's times are the run's
  // Expected output: live, the bus leg matched 180 s late, and only the 99's detour with its text tidied and end
  //                  time: not the other route's, nor the network-wide notice for all buses
  test('returns live times and alerts for the active trip', async () => {
    const { token, departAt, tripId } = await activeBusTrip();
    const fetchSpy = translink(departAt);

    const res = await getLive(tripId, token);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      `https://gtfsapi.translink.ca/v3/gtfsrealtime?apikey=${FAKE_TRANSLINK_KEY}`,
      `https://gtfsapi.translink.ca/v3/gtfsalerts?apikey=${FAKE_TRANSLINK_KEY}`,
    ]));
    const body = res.body as { live: boolean; updatedAt: string; legs: unknown[]; alerts: { activeUntil: string }[] };
    expect(body.live).toBe(true);
    expect(Math.abs(Date.parse(body.updatedAt) - Date.now())).toBeLessThan(5000);
    expect(body.legs).toStrictEqual([{
      legIndex: 0,
      matched: true,
      departAt: new Date(Math.floor(departAt.getTime() / 1000) * 1000 + DELAY * 1000).toISOString(),
      arriveAt: new Date(Math.floor(departAt.getTime() / 1000) * 1000 + (2100 + DELAY) * 1000).toISOString(),
      delaySeconds: DELAY,
      cancelled: false,
    }]);
    expect(body.alerts).toStrictEqual([{
      id: 'detour-99',
      header: '99 detour at Main St',
      description: 'Regular route, then Main St.\n\nNo stops missed.',
      effect: 'DETOUR',
      legIndexes: [0],
      activeUntil: expect.any(String) as unknown,
    }]);
    expect(Date.parse(body.alerts[0]?.activeUntil ?? '') - Date.now()).toBeGreaterThan(7000_000);
  });

  // Mocked behavior: TransLink's trip updates feed has the planned 99 run cancelled
  // Input: the active trip
  // Expected status code: 200
  // Expected behavior: the run is found by trip_id, and its cancellation is passed on
  // Expected output: live, the bus leg matched and cancelled at its scheduled times with no delay, the detour shown
  test('marks a leg whose run TransLink cancelled', async () => {
    const { token, departAt, tripId } = await activeBusTrip();
    translink(departAt, { tripUpdates: () => bus99Feed(Math.floor(Date.now() / 1000), departAt, DELAY, true) });

    const res = await getLive(tripId, token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      live: true,
      legs: [{ legIndex: 0, matched: true, cancelled: true, departAt: departAt.toISOString(), delaySeconds: null }],
      alerts: [{ id: 'detour-99' }],
    });
  });

  // Mocked behavior: TransLink as above
  // Input: the same trip requested twice in a row
  // Expected status code: 200 both times
  // Expected behavior: the second request is answered from the poller's copy, with no new TransLink request
  // Expected output: the same live times
  test('answers repeat requests from the poller without asking TransLink again', async () => {
    const { token, departAt, tripId } = await activeBusTrip();
    const fetchSpy = translink(departAt);

    const first = await getLive(tripId, token);
    const second = await getLive(tripId, token);

    expect(second.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second.body).toStrictEqual(first.body);
  });

  // Mocked behavior: TransLink as above
  // Input: the trip on leg 1, the walk after the bus
  // Expected status code: 200
  // Expected behavior: only the alerts feed is fetched, since no transit leg is left
  // Expected output: live, with no legs and no alerts
  test('polls only alerts once no transit leg is left', async () => {
    const { token, departAt, tripId } = await activeBusTrip();
    const fetchSpy = translink(departAt);

    const res = await getLive(tripId, token, '?fromLeg=1');

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/v3/gtfsalerts?');
    expect(res.body).toMatchObject({ live: true, legs: [], alerts: [] });
  });

  // Mocked behavior: TransLink refuses the trip updates feed with 429, then 403; alerts work
  // Input: the active trip, then the same trip again, for each refusal
  // Expected status code: 200
  // Expected behavior: the refused feed isn't asked for again during the back-off
  // Expected output: not live, the leg at its scheduled times, the detour still shown
  test.each([429, 403])('falls back to scheduled times when TransLink refuses with %i', async (status) => {
    const { token, departAt, tripId } = await activeBusTrip();
    const fetchSpy = translink(departAt, { tripUpdates: () => status });

    const res = await getLive(tripId, token);
    await getLive(tripId, token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      live: false,
      updatedAt: null,
      legs: [{ legIndex: 0, matched: false, departAt: departAt.toISOString(), delaySeconds: null, cancelled: false }],
      alerts: [{ id: 'detour-99' }],
    });
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('gtfsrealtime'))).toHaveLength(1);
    expect(logged.join('\n')).toContain(`HTTP ${status}`);
  });

  // Mocked behavior: TransLink's trip updates fail with HTTP 500, a network error whose message holds the URL with
  //                  the key, an HTML page sent as 200, and a feed made 5 minutes ago
  // Input: the active trip, once per failure
  // Expected status code: 200
  // Expected behavior: each is logged with the key removed
  // Expected output: not live, the leg at its scheduled times
  test.each([
    ['an HTTP error', () => 500],
    ['a network error', () => new TypeError(`fetch failed for https://gtfsapi.translink.ca/v3/gtfsrealtime?apikey=${FAKE_TRANSLINK_KEY}`, { cause: new Error(`connect ECONNREFUSED (${FAKE_TRANSLINK_KEY})`) })],
    ['an undecodable body', () => new Uint8Array(Buffer.from('<html><body>Service unavailable</body></html>'))],
    ['a stale feed', () => feedBytes(Math.floor(Date.now() / 1000) - 300, [])],
  ] as [string, () => FakeAnswer][])('says not live for %s', async (_name, answer) => {
    const { token, departAt, tripId } = await activeBusTrip();
    translink(departAt, { tripUpdates: answer });

    const res = await getLive(tripId, token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ live: false, updatedAt: null, legs: [{ legIndex: 0, matched: false }] });
  });

  // Mocked behavior: TransLink works, but today's count is already at the daily cap
  // Input: the active trip
  // Expected status code: 200
  // Expected behavior: TransLink isn't asked, and the count stays at the cap
  // Expected output: not live, no alerts
  test('stops at the daily cap', async () => {
    const { token, departAt, tripId } = await activeBusTrip();
    await TranslinkQuotaModel.create({ _id: pacificDay(new Date()), count: DAILY_REQUEST_CAP });
    const fetchSpy = translink(departAt);

    const res = await getLive(tripId, token);

    expect(res.body).toMatchObject({ live: false, legs: [{ matched: false }], alerts: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await TranslinkQuotaModel.findById(pacificDay(new Date())).lean())?.count).toBe(DAILY_REQUEST_CAP);
  });

  // Mocked behavior: TransLink works; the request count is one under the cap
  // Input: the active trip, which needs both feeds
  // Expected status code: 200
  // Expected behavior: only one feed is fetched, the count reaches the cap, and the cap is logged
  // Expected output: not live
  test('spends the last request and logs the cap', async () => {
    const { token, departAt, tripId } = await activeBusTrip();
    await TranslinkQuotaModel.create({ _id: pacificDay(new Date()), count: DAILY_REQUEST_CAP - 1 });
    const fetchSpy = translink(departAt);

    const res = await getLive(tripId, token);

    expect(res.body).toMatchObject({ live: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await TranslinkQuotaModel.findById(pacificDay(new Date())).lean())?.count).toBe(DAILY_REQUEST_CAP);
    expect(logged.join('\n')).toContain(`${DAILY_REQUEST_CAP}/${DAILY_REQUEST_CAP}, the cap`);
  });

  // Mocked behavior: counting the request in the database fails
  // Input: the active trip
  // Expected status code: 200
  // Expected behavior: TransLink isn't asked, since the cap can't be checked, and the error is logged
  // Expected output: not live
  test('does not ask TransLink when the quota cannot be checked', async () => {
    const { token, departAt, tripId } = await activeBusTrip();
    jest.spyOn(TranslinkQuotaModel, 'findOneAndUpdate').mockRejectedValue(new Error('Simulated database error'));
    const fetchSpy = translink(departAt);

    const res = await getLive(tripId, token);

    expect(res.body).toMatchObject({ live: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain('Simulated database error');
  });

  // Mocked behavior: no TRANSLINK_API_KEY is set
  // Input: the active trip
  // Expected status code: 200
  // Expected behavior: TransLink isn't asked
  // Expected output: not live, with scheduled times
  test('says not live without an API key', async () => {
    const { token, departAt, tripId } = await activeBusTrip();
    process.env.TRANSLINK_API_KEY = '  ';
    const fetchSpy = translink(departAt);

    const res = await getLive(tripId, token);

    expect(res.body).toMatchObject({ live: false, legs: [{ matched: false }] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Mocked behavior: loading the trip fails
  // Input: the active trip
  // Expected status code: 500
  // Expected behavior: the error handler answers
  // Expected output: { error: 'Internal Server Error' }
  test('returns 500 when the trip cannot be loaded', async () => {
    const { token, tripId } = await activeBusTrip();
    jest.spyOn(TripModel, 'findOne').mockReturnValueOnce(Promise.reject(new Error('Simulated database error')) as never);

    const res = await getLive(tripId, token);

    expect(res.status).toBe(500);
    expect(res.body).toStrictEqual({ error: 'Internal Server Error' });
  });

  // Mocked behavior: every failure above, one after another, each logged
  // Input: the active trip, once per failure
  // Expected status code: 200
  // Expected behavior: the key appears in no log line and no response, and logged URLs say apikey=REDACTED
  // Expected output: n/a
  test('never logs or returns the API key', async () => {
    const answers: FakeAnswer[] = [
      429, 500, new TypeError(`fetch failed: ${FAKE_TRANSLINK_KEY}`), new Uint8Array([0x0a, 0xff]),
    ];
    const bodies: string[] = [];
    for (const answer of answers) {
      const { token, departAt, tripId } = await activeBusTrip();
      liveFeeds.reset();
      jest.spyOn(globalThis, 'fetch').mockRestore();
      translink(departAt, { tripUpdates: () => answer, alerts: () => answer });
      bodies.push(JSON.stringify((await getLive(tripId, token)).body));
    }

    expect(logged.length).toBeGreaterThan(4);
    expect(logged.some((line) => line.includes('apikey=REDACTED'))).toBe(true);
    for (const text of [...logged, ...bodies]) expect(text).not.toContain(FAKE_TRANSLINK_KEY);
  });
});
