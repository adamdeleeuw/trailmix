/**
 * Builds the live update for a trip from TransLink's feeds (#87).
 *
 * @remarks
 * {@link buildLiveUpdate} is pure, so tests give it saved or built feeds; {@link liveUpdateFor} asks the poller for
 * the feeds and builds the message.
 */
import type { LiveAlert, LiveLeg, LiveUpdate } from '../models/live-update.model';
import type { Leg } from '../models/trip.model';
import type { Alert } from './gtfs-rt-decoder';
import type { FeedSnapshot, FeedState } from './live-feeds';
import { liveFeeds } from './live-feeds';
import { alertsForLines, matchLine, predictLine } from './live-match';
import { translinkStatic, type TranslinkStatic } from './translink-static';

/** How old TransLink's data may be and still count as live. Its feeds refresh about every 30 s. */
export const STALE_AFTER_MS = 2 * 60_000;
const FALLBACK_HEADER = 'Service alert';

/** Whether a leg is one LiveUpdates can predict: transit, with lines to match. */
const isTransit = (leg: Leg) => leg.mode === 'TRANSIT' && leg.transitLines.length > 0;

/**
 * Whether a trip has a transit leg from `fromLeg` on, so it needs trip updates as well as alerts.
 *
 * @param legs - The trip's legs.
 * @param fromLeg - The leg the rider is on.
 */
export function hasTransitAhead(legs: readonly Leg[], fromLeg: number): boolean {
  return legs.some((leg, index) => index >= fromLeg && isTransit(leg));
}

/** A feed's data, when its last fetch worked and TransLink made it recently enough to be live. */
function fresh(state: FeedState | null, now: number): (FeedState & { madeAt: number }) | null {
  if (state?.status !== 'ok' || state.feed === null) return null;
  const madeAt = state.feed.timestamp === null ? state.fetchedAt : state.feed.timestamp * 1000;
  if (madeAt === null || now - madeAt > STALE_AFTER_MS) return null;
  return { ...state, madeAt };
}

/** The end of the alert's period that `now` is in, or null when it lasts until further notice. */
function activeUntil(alert: Alert, nowSeconds: number): Date | null {
  const current = alert.activePeriods.find((period) =>
    (period.start ?? 0) <= nowSeconds && (period.end === null || nowSeconds < period.end));
  return current?.end === null || current?.end === undefined ? null : new Date(current.end * 1000);
}

/** TransLink's text with Windows line endings and stray whitespace tidied, or null when there's none. */
function tidy(text: string | null): string | null {
  const tidied = text?.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() ?? '';
  return tidied === '' ? null : tidied;
}

/** A transit leg's times from the trip's schedule, for when there's no prediction. */
function scheduled(leg: Leg, legIndex: number): LiveLeg {
  return { legIndex, matched: false, departAt: leg.departAt, arriveAt: leg.arriveAt, delaySeconds: null, cancelled: false };
}

/**
 * Builds the live update message for a trip.
 *
 * @remarks
 * A leg is matched when TransLink predicts the run its first line was planned to board: its departure is that
 * run's, and its arrival is the last line's predicted arrival, or else the scheduled arrival moved by the same delay.
 * When that run, or the one a transfer boards, is cancelled, the leg is matched and cancelled, at scheduled times.
 * Alerts are included whenever the alerts feed is live, even if trip updates aren't, so a detour still shows.
 *
 * @param legs - The trip's legs.
 * @param fromLeg - The leg the rider is on; earlier legs are done and left out.
 * @param feeds - TransLink's feeds, from the poller.
 * @param network - TransLink's routes and stops.
 * @param now - The time, in ms since the epoch.
 * @returns The message. `live` is false unless every feed the trip needs is fresh.
 */
export function buildLiveUpdate(
  legs: readonly Leg[],
  fromLeg: number,
  feeds: FeedSnapshot,
  network: TranslinkStatic,
  now: number,
): LiveUpdate {
  const transitAhead = legs.flatMap((leg, legIndex) => legIndex >= fromLeg && isTransit(leg) ? [{ leg, legIndex }] : []);
  const tripUpdates = transitAhead.length > 0 ? fresh(feeds.tripUpdates, now) : null;
  const alertsFeed = fresh(feeds.alerts, now);
  const live = alertsFeed !== null && (transitAhead.length === 0 || tripUpdates !== null);

  // every line of the legs ahead, matched once, remembering which leg each is on
  const lines = transitAhead.flatMap(({ leg, legIndex }) => leg.transitLines.map((line) => ({
    line, legIndex, match: matchLine(line, network),
  })));

  const runs = tripUpdates?.feed ?? null;
  const liveLegs = transitAhead.map(({ leg, legIndex }): LiveLeg => {
    const legLines = lines.filter((entry) => entry.legIndex === legIndex);
    const first = legLines[0];
    const last = legLines[legLines.length - 1];
    const plannedDepart = first?.line.departAt ?? leg.departAt;
    if (runs === null || first?.match == null || plannedDepart === null) return scheduled(leg, legIndex);
    const departure = predictLine(runs, first.match, plannedDepart, network);
    if (departure === null) return scheduled(leg, legIndex);

    // a leg with a transfer arrives on its last line, whose run is predicted the same way
    const lastPlanned = last?.line.departAt ?? null;
    const arrival = last === first ? departure
      : last?.match == null || lastPlanned === null ? null : predictLine(runs, last.match, lastPlanned, network);
    // the run boarded, or the one transferred to, isn't coming: TransLink knows the run, but there's no time to show
    if (departure.cancelled || arrival?.cancelled === true) return { ...scheduled(leg, legIndex), matched: true, cancelled: true };
    const shiftedArrival = leg.arriveAt === null ? null : new Date(leg.arriveAt.getTime() + departure.delaySeconds * 1000);
    return {
      legIndex,
      matched: true,
      departAt: departure.departAt,
      arriveAt: arrival?.arriveAt ?? shiftedArrival,
      delaySeconds: departure.delaySeconds,
      cancelled: false,
    };
  });

  const nowSeconds = Math.floor(now / 1000);
  const alerts: LiveAlert[] = alertsFeed?.feed == null ? [] : alertsForLines(
    alertsFeed.feed,
    lines.map((entry) => entry.match),
    network,
    nowSeconds,
  ).map(({ id, alert, lineIndexes }) => ({
    id,
    header: tidy(alert.header) ?? FALLBACK_HEADER,
    description: tidy(alert.description),
    effect: alert.effect,
    legIndexes: [...new Set(lineIndexes.map((index) => lines[index]?.legIndex ?? -1))].filter((index) => index >= 0),
    activeUntil: activeUntil(alert, nowSeconds),
  }));

  const madeAt = [alertsFeed?.madeAt, tripUpdates?.madeAt].filter((time): time is number => time !== undefined);
  return {
    live,
    updatedAt: live ? new Date(Math.min(...madeAt)) : null,
    legs: live ? liveLegs : transitAhead.map(({ leg, legIndex }) => scheduled(leg, legIndex)),
    alerts,
  };
}

/**
 * Gets the live update for one of a user's active trips.
 *
 * @param tripId - The trip, so the poller counts its requests as one rider.
 * @param legs - The trip's legs.
 * @param fromLeg - The leg the rider is on.
 * @returns The message; `live: false` with scheduled times when TransLink can't be used.
 */
export async function liveUpdateFor(tripId: string, legs: readonly Leg[], fromLeg: number): Promise<LiveUpdate> {
  const feeds = await liveFeeds.want(tripId, hasTransitAhead(legs, fromLeg));
  return buildLiveUpdate(legs, fromLeg, feeds, translinkStatic(), liveFeeds.now());
}
