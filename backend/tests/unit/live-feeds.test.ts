import type { Feed } from '../../src/services/gtfs-rt-decoder';
import { BACKOFF_MS, DEMAND_WINDOW_MS, LiveFeedPoller, POLL_INTERVAL_MS } from '../../src/services/live-feeds';
import type { FeedFetchResult, FeedKind } from '../../src/services/translink-api';
import { FakeClock } from '../helpers/fake-clock';

const feed = (timestamp: number): Feed => ({ timestamp, entities: [] });

describe('LiveFeedPoller', () => {
  let clock: FakeClock;
  let calls: FeedKind[];
  let answer: (kind: FeedKind) => FeedFetchResult;
  let poller: LiveFeedPoller;

  beforeEach(() => {
    clock = new FakeClock();
    calls = [];
    answer = () => ({ status: 'ok', feed: feed(Math.floor(clock.time / 1000)) });
    poller = new LiveFeedPoller(clock.deps(async (kind) => {
      calls.push(kind);
      return answer(kind);
    }));
  });

  // Input: no request at all, for ten minutes
  // Expected behavior: TransLink is never asked
  test('does not poll without demand', async () => {
    await clock.advance(10 * 60_000);

    expect(calls).toStrictEqual([]);
    expect(clock.pending).toBe(0);
  });

  // Input: a trip with transit ahead asks once, then time passes
  // Expected behavior: both feeds are fetched at once and every 30 s while the request is recent, then polling stops
  //                    2 minutes after it
  test('polls both feeds every 30 s for a trip with transit ahead, then stops', async () => {
    const snapshot = await poller.want('trip', true);

    expect(snapshot.tripUpdates?.status).toBe('ok');
    expect(snapshot.alerts?.status).toBe('ok');
    expect(calls).toStrictEqual(['tripUpdates', 'alerts']);

    await clock.advance(DEMAND_WINDOW_MS + POLL_INTERVAL_MS * 2);

    // at 30, 60, 90 and 120 s; at 150 s the request is older than the window, so polling stops
    expect(calls.filter((kind) => kind === 'tripUpdates')).toHaveLength(5);
    expect(calls.filter((kind) => kind === 'alerts')).toHaveLength(5);
    expect(clock.pending).toBe(0);
  });

  // Input: a trip with no transit ahead asks every 15 s for two minutes
  // Expected behavior: only alerts are fetched, at 0, 30, 60, 90 and 120 s; the repeat requests add no fetches
  test('polls only alerts when no transit is ahead', async () => {
    for (let elapsed = 0; elapsed < 2 * 60_000; elapsed += 15_000) {
      const snapshot = await poller.want('trip', false);
      expect(snapshot.tripUpdates).toBeNull();
      await clock.advance(15_000);
    }

    expect(calls.every((kind) => kind === 'alerts')).toBe(true);
    expect(calls).toHaveLength(5);
  });

  // Input: a trip asks for alerts only, then its rider boards transit and it asks for trip updates too
  // Expected behavior: trip updates are fetched right away, not at the next tick
  test('fetches trip updates as soon as a trip needs them', async () => {
    await poller.want('trip', false);
    await clock.advance(5000);
    const snapshot = await poller.want('trip', true);

    expect(snapshot.tripUpdates?.status).toBe('ok');
    expect(calls).toStrictEqual(['alerts', 'tripUpdates']);
  });

  // Input: TransLink rate-limits trip updates with a Retry-After of 10 minutes; requests keep coming
  // Expected behavior: trip updates aren't asked for again until the Retry-After has passed; alerts carry on
  test('backs off after a refusal', async () => {
    answer = (kind) => kind === 'tripUpdates' ? { status: 'rate-limited', retryAfterSeconds: 600 } : { status: 'ok', feed: feed(0) };
    const first = await poller.want('trip', true);
    expect(first.tripUpdates?.status).toBe('rate-limited');

    for (let elapsed = 0; elapsed < 10 * 60_000; elapsed += 15_000) {
      await clock.advance(15_000);
      await poller.want('trip', true);
    }

    expect(calls.filter((kind) => kind === 'tripUpdates')).toHaveLength(2); // the first, then after 10 minutes
    expect(calls.filter((kind) => kind === 'alerts').length).toBeGreaterThan(15);
    expect(BACKOFF_MS).toBeLessThan(600_000);
  });

  // Input: two trips ask at the same moment, before any feed has been fetched
  // Expected behavior: one poll serves both
  test('shares one poll between requests', async () => {
    await Promise.all([poller.want('a', true), poller.want('b', true)]);

    expect(calls).toStrictEqual(['tripUpdates', 'alerts']);
  });

  // Input: fetching a feed throws (the quota couldn't be read)
  // Expected behavior: the feed is reported failed and the error logged, not thrown
  test('reports a fetch that throws as failed', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    answer = () => { throw new Error('Simulated database error'); };

    const snapshot = await poller.want('trip', false);

    expect(snapshot.alerts).toStrictEqual({ status: 'failed', feed: null, fetchedAt: clock.time });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  // Input: TransLink never answers the first request
  // Expected behavior: the request waits about 8 s, then answers without the feed
  test('does not wait forever for the first fetch', async () => {
    const never = new LiveFeedPoller(clock.deps(() => new Promise<FeedFetchResult>(() => undefined)));

    const pending = never.want('trip', false);
    await clock.advance(10_000);

    await expect(pending).resolves.toStrictEqual({ tripUpdates: null, alerts: null });
  });

  // Input: polling is running; then reset
  // Expected behavior: the timer is cleared and the feeds forgotten
  test('reset stops polling', async () => {
    await poller.want('trip', true);
    poller.reset();
    await clock.advance(5 * 60_000);

    expect(calls).toHaveLength(2);
    expect(clock.pending).toBe(0);
  });
});
