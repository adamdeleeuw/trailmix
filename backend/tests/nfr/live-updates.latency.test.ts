import request from 'supertest';
import { createApp } from '../../src/app';
import { liveFeeds } from '../../src/services/live-feeds';
import { fetchTranslinkFeed } from '../../src/services/translink-api';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { FakeClock } from '../helpers/fake-clock';
import { feedBytes } from '../helpers/gtfs-rt';
import { bus99Feed, busThenWalkLegs, createLiveTrip, detourFeed, fakeTranslink, FAKE_TRANSLINK_KEY } from '../helpers/live';

// NFR 3 (Live Update Latency): a TransLink delay or alert on one of the active trip's lines reaches the app within
// 60 seconds of TransLink publishing it.
//
// The real app, endpoint, poller, quota and database, with TransLink faked by mocking fetch and the poller on a fake
// clock, so minutes of polling run in about a second. The client polls every 15 s, as the app does in Navigation.
// The change is published at every 3 s of the poller's 30 s cycle, and the client's polls are shifted 0 to 14 s
// from the poller's, so the worst case (a change just after a poll, seen by a client just before the next one: about
// 30 + 15 s) is measured, not one lucky phase.
useTestDatabase();

const CLIENT_POLL_MS = 15_000;
const TARGET_MS = 60_000;
const NEW_DELAY = 300;
const CYCLE_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000;

let clock: FakeClock;

beforeEach(() => {
  process.env.TRANSLINK_API_KEY = FAKE_TRANSLINK_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  clock = new FakeClock();
  liveFeeds.useDeps({ ...clock.deps(fetchTranslinkFeed) });
});

afterEach(() => {
  liveFeeds.useDeps();
  jest.restoreAllMocks();
  process.env.TRANSLINK_API_KEY = '';
});

type Change = 'delay' | 'alert';

/**
 * Starts a trip at the fake clock's time (its first request starts the poller), publishes a change `changeAfterMs`
 * later, and polls like the app, `clientPhaseMs` out of step with the poller, until the client sees it.
 *
 * @returns How long after publishing the client saw it, in ms.
 */
async function latency(change: Change, changeAfterMs: number, clientPhaseMs: number): Promise<number> {
  const start = clock.time;
  const publishedAt = start + changeAfterMs;
  const departAt = new Date(start + 20 * 60_000);
  const { user, token } = await createSignedInUser();
  const trip = await createLiveTrip(user._id, busThenWalkLegs(departAt));
  const seconds = () => Math.floor(clock.time / 1000);
  const published = () => clock.time >= publishedAt;

  fakeTranslink((kind) => {
    if (kind === 'tripUpdates') return bus99Feed(seconds(), departAt, change === 'delay' && published() ? NEW_DELAY : 0);
    return change === 'alert' && published() ? detourFeed(seconds(), seconds() + 3600) : feedBytes(seconds(), []);
  });

  // a fresh app per run: the fake clock squeezes minutes of polling into real seconds, which the real-time
  // per-address rate limit (#89) would otherwise count as one client flooding the API
  const app = createApp();
  const getLive = () => request(app).get(`/api/users/me/trips/${trip._id.toHexString()}/live`).set('Authorization', bearer(token));
  expect((await getLive()).status).toBe(200);
  await clock.advance(clientPhaseMs);
  for (;;) {
    const res = await getLive();
    const body = res.body as { live: boolean; legs: { delaySeconds: number | null }[]; alerts: unknown[] };
    expect(res.status).toBe(200);
    expect(body.live).toBe(true);
    const seen = change === 'delay' ? body.legs[0]?.delaySeconds === NEW_DELAY : body.alerts.length > 0;
    if (seen) {
      expect(published()).toBe(true);
      return clock.time - publishedAt;
    }
    if (clock.time - publishedAt > 2 * TARGET_MS) throw new Error(`The ${change} never reached the client`);
    await clock.advance(CLIENT_POLL_MS);
  }
}

describe('NFR 3: live update latency', () => {
  test.each(['delay', 'alert'] as Change[])('a new %s reaches a client polling every 15 s within 60 s', async (change) => {
    const latencies: number[] = [];
    for (const clientPhase of [0, 5000, 10_000, 14_000]) {
      for (let offset = 0; offset < CYCLE_MS; offset += 3000) {
        liveFeeds.reset();
        clock.time += 10 * 60_000; // a fresh start, well clear of the last trip's polling
        latencies.push(await latency(change, offset + 1, clientPhase));
        jest.spyOn(globalThis, 'fetch').mockRestore();
      }
    }

    const worst = Math.max(...latencies);
    process.stdout.write(`NFR 3 ${change}: worst ${worst / 1000} s, mean ${(latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(1)} s over ${latencies.length} phases\n`);
    expect(worst).toBeLessThanOrEqual(TARGET_MS);
  }, TEST_TIMEOUT_MS);
});
