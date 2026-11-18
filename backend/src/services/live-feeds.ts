/**
 * Polls TransLink's feeds while someone is navigating a trip, so live updates answer from memory (#87).
 *
 * @remarks
 * Polling only happens on demand: each live update request says whether its trip still has a transit leg to ride.
 * While any request in the last {@link DEMAND_WINDOW_MS} wanted trip updates, both feeds are fetched every
 * {@link POLL_INTERVAL_MS}; while requests only want alerts (every transit leg is done, or there were none), only
 * the alerts feed is. With no requests for {@link DEMAND_WINDOW_MS}, polling stops until the next one.
 *
 * The app polls every 15 s, so a change in TransLink's feed reaches it within 30 + 15 s, under NFR 3's 60 s.
 *
 * TransLink allows 1,000 requests a day, so continuous polling of both feeds lasts about 4 hours a day before the
 * cap in `translink-quota.ts` stops it; after a 429 or 403, a feed isn't asked for again for {@link BACKOFF_MS}.
 */
import { fetchTranslinkFeed, type FeedFetchResult, type FeedKind, type FeedStatus } from './translink-api';
import type { Feed } from './gtfs-rt-decoder';

export const POLL_INTERVAL_MS = 30_000;
export const DEMAND_WINDOW_MS = 2 * 60_000;
export const BACKOFF_MS = 5 * 60_000;
const FIRST_FETCH_WAIT_MS = 8_000; // how long a request waits for a feed that has never been fetched
const EARLY_MS = 1_000; // a feed fetched this close to the interval ago is due, so timer jitter doesn't skip a poll

/** The latest attempt at one feed. `feed` is null unless that attempt worked. */
export interface FeedState {
  status: FeedStatus;
  feed: Feed | null;
  fetchedAt: number | null; // ms since the epoch
}

/** Both feeds, as the last polls left them. A feed nobody needed is null. */
export interface FeedSnapshot {
  tripUpdates: FeedState | null;
  alerts: FeedState | null;
}

/** What the poller needs from the outside world, so tests can run it on a fake clock and fake TransLink. */
export interface PollerDeps {
  fetchFeed: (kind: FeedKind, now: Date) => Promise<FeedFetchResult>;
  now: () => number;
  setTimer: (callback: () => Promise<void>, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const realDeps: PollerDeps = {
  fetchFeed: fetchTranslinkFeed,
  now: () => Date.now(),
  setTimer: (callback, ms) => {
    const timer = setTimeout(() => { void callback(); }, ms);
    timer.unref(); // polling alone never keeps the process alive
    return timer;
  },
  clearTimer: (handle) => { clearTimeout(handle as NodeJS.Timeout); },
};

const KINDS: readonly FeedKind[] = ['tripUpdates', 'alerts'];

/** Polls TransLink's feeds while there's demand for them. One instance serves the whole server. */
export class LiveFeedPoller {
  private readonly demand = new Map<string, { at: number; tripUpdates: boolean }>(); // by trip ID
  private readonly states: Record<FeedKind, FeedState | null> = { tripUpdates: null, alerts: null };
  private readonly backoffUntil: Record<FeedKind, number> = { tripUpdates: 0, alerts: 0 };
  private timer: unknown = null;
  private polling: Promise<void> | null = null;

  constructor(private deps: PollerDeps = realDeps) {}

  /** Resets the poller and runs it on other deps, e.g. a fake clock. For tests; `realDeps` when left out. */
  useDeps(deps: PollerDeps = realDeps): void {
    this.reset();
    this.deps = deps;
  }

  now(): number {
    return this.deps.now();
  }

  /**
   * Records that a trip wants live data, and returns the feeds as they are.
   *
   * @remarks
   * Starts polling if it had stopped. A feed that has never been fetched is fetched first, so the first request of
   * a trip gets live data rather than waiting a whole interval.
   *
   * @param tripId - The trip asking, so one trip polling every 15 s counts once.
   * @param tripUpdates - Whether the trip has a transit leg left, so it needs trip updates as well as alerts.
   * @returns The feeds the trip needs.
   */
  async want(tripId: string, tripUpdates: boolean): Promise<FeedSnapshot> {
    this.demand.set(tripId, { at: this.deps.now(), tripUpdates });
    const needed = tripUpdates ? KINDS : (['alerts'] as const);
    if (needed.some((kind) => this.states[kind] === null) || this.timer === null) {
      await this.withTimeout(this.poll());
    }
    if (this.timer === null) this.schedule();
    return { tripUpdates: tripUpdates ? this.states.tripUpdates : null, alerts: this.states.alerts };
  }

  /** Stops polling and forgets every feed and request. For tests, and shutdown. */
  reset(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.polling = null;
    this.demand.clear();
    this.states.tripUpdates = null;
    this.states.alerts = null;
    this.backoffUntil.tripUpdates = 0;
    this.backoffUntil.alerts = 0;
  }

  private schedule(): void {
    this.timer = this.deps.setTimer(async () => {
      this.timer = null;
      await this.poll();
      if (this.demand.size > 0) this.schedule();
    }, POLL_INTERVAL_MS);
  }

  /** Waits for a poll, but not longer than a request should; the poll carries on either way. */
  private async withTimeout(poll: Promise<void>): Promise<void> {
    let handle: unknown = null;
    const timeout = new Promise<void>((resolve) => { handle = this.deps.setTimer(async () => { resolve(); }, FIRST_FETCH_WAIT_MS); });
    await Promise.race([poll, timeout]);
    this.deps.clearTimer(handle);
  }

  /** Fetches each feed that's wanted and due. Polls never overlap: a second caller waits for the first. */
  private poll(): Promise<void> {
    this.polling ??= this.pollOnce().finally(() => { this.polling = null; });
    return this.polling;
  }

  private async pollOnce(): Promise<void> {
    const now = this.deps.now();
    for (const [tripId, { at }] of this.demand) {
      if (now - at > DEMAND_WINDOW_MS) this.demand.delete(tripId);
    }
    const wanted = new Set<FeedKind>();
    for (const { tripUpdates } of this.demand.values()) {
      wanted.add('alerts');
      if (tripUpdates) wanted.add('tripUpdates');
    }
    // a feed nobody wants any more is dropped, so a stale one is never served when demand comes back
    for (const kind of KINDS) if (!wanted.has(kind)) this.states[kind] = null;

    const due = KINDS.filter((kind) => wanted.has(kind)).filter((kind) => {
      const fetchedAt = this.states[kind]?.fetchedAt ?? null;
      return now >= this.backoffUntil[kind] && (fetchedAt === null || now - fetchedAt >= POLL_INTERVAL_MS - EARLY_MS);
    });
    // one at a time, so the daily cap is checked before each request
    for (const kind of due) {
      this.states[kind] = await this.fetchOne(kind, now);
    }
  }

  private async fetchOne(kind: FeedKind, now: number): Promise<FeedState> {
    let result: FeedFetchResult;
    try {
      result = await this.deps.fetchFeed(kind, new Date(now));
    } catch (err) {
      console.error(err); // the quota couldn't be read, so don't risk going over it
      result = { status: 'failed' };
    }
    if (result.status === 'ok') return { status: 'ok', feed: result.feed, fetchedAt: now };
    if (result.status === 'rate-limited') {
      this.backoffUntil[kind] = now + Math.max(BACKOFF_MS, (result.retryAfterSeconds ?? 0) * 1000);
    }
    return { status: result.status, feed: null, fetchedAt: now };
  }
}

/** The server's poller. */
export const liveFeeds = new LiveFeedPoller();
