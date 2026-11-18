/**
 * Matches a trip's transit lines to TransLink's routes and stops, and finds the alerts and predictions for them in
 * TransLink's real-time feeds (#87). Pure functions, so they're tested with saved feeds and a small network.
 *
 * @remarks
 * Google names a trip's lines and stops, but TransLink's feeds use its own IDs, and the two don't always match:
 * Google's "99" is TransLink's "099", and Google's "UBC Exchange Bay 7" is TransLink's "UBC Exchange @ Bay 7". So a
 * line matches a route by its short name (or by name for SkyTrain lines, which have none), and each stop is the
 * nearest one that route serves in that direction, with the alighting stop after the boarding one. The direction
 * whose boarding and alighting stops are both closest wins, which tells a stop from the one across the street, and
 * a SkyTrain platform from the one beside it.
 */
import type { TransitLine } from '../models/trip.model';
import type { Alert, Feed, InformedEntity, StopTimeEvent, StopTimeUpdate, TripUpdate } from './gtfs-rt-decoder';
import { distanceMeters } from './planner.core';
import { routeIdForTrip, type TranslinkRoute, type TranslinkStatic, type TranslinkStop } from './translink-static';

/** How far Google's stop may be from TransLink's and still be the same stop. */
export const MAX_STOP_DISTANCE_METERS = 150;
/** How far a run's scheduled departure may be from the trip's and still be the run the user planned to take. */
export const MAX_RUN_OFFSET_SECONDS = 10 * 60;

/** A trip's transit line, as TransLink's route, direction and stops. */
export interface LineMatch {
  routeId: string;
  directionId: 0 | 1;
  boardingStopId: string;
  alightingStopId: string | null; // null when no stop in that direction is near Google's
}

/** What TransLink predicts for the run a line's rider planned to take. */
export interface LinePrediction {
  departAt: Date; // predicted departure from the boarding stop
  arriveAt: Date | null; // predicted arrival at the alighting stop, when the feed has it
  delaySeconds: number; // how much later than the trip planned, negative when early
  cancelled: boolean; // the run is cancelled, or skips the boarding stop
}

/** An active alert that applies to some of a trip's lines. */
export interface LineAlert {
  id: string; // the feed entity's ID, stable while the alert lasts
  alert: Alert;
  lineIndexes: number[]; // indexes into the lines passed to alertsForLines
}

// ---- lines and stops ----

/** "099" and "99" are the same bus, and "r4" is "R4". */
function normalizeShortName(name: string): string {
  return name.trim().toUpperCase().replace(/^0+(?=.)/, '');
}

/** "UBC Exchange @ Bay 7" and "UBC Exchange Bay 7" are the same stop. */
function normalizeStopName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The routes a line could be: by short name when it has one, else by name ("Expo Line", "SeaBus"). */
function candidateRoutes(line: TransitLine, network: TranslinkStatic): TranslinkRoute[] {
  const shortName = normalizeShortName(line.shortName ?? '');
  if (shortName !== '') return network.routes.filter((route) => normalizeShortName(route.shortName) === shortName);
  const name = line.name.trim().toLowerCase();
  return network.routes.filter((route) => route.shortName === '' && route.longName.trim().toLowerCase() === name);
}

/** The stop of `stopIds` that is Google's stop, and how far off it is (0 for a name match), or null. */
function findStop(
  stopIds: readonly string[],
  network: TranslinkStatic,
  location: TransitLine['departureStopLocation'],
  name: string | null,
): { stop: TranslinkStop; distance: number } | null {
  const stops = stopIds.flatMap((id) => network.stopsById.get(id) ?? []);
  if (location !== null) {
    let best: { stop: TranslinkStop; distance: number } | null = null;
    for (const stop of stops) {
      const distance = distanceMeters(location, stop);
      if (distance <= MAX_STOP_DISTANCE_METERS && (best === null || distance < best.distance)) best = { stop, distance };
    }
    return best;
  }
  // trips saved before #87 have no stop locations, so only an exact name will do
  const wanted = normalizeStopName(name ?? '');
  const stop = wanted === '' ? undefined : stops.find((candidate) => normalizeStopName(candidate.name) === wanted);
  return stop === undefined ? null : { stop, distance: 0 };
}

/**
 * Finds the TransLink route, direction and stops of one of a trip's transit lines.
 *
 * @param line - The line, as the trip stored it.
 * @param network - TransLink's routes and stops.
 * @returns The match, or null when no route has the line's name or none of its stops is near the boarding stop.
 */
export function matchLine(line: TransitLine, network: TranslinkStatic): LineMatch | null {
  let best: (LineMatch & { score: number }) | null = null;
  for (const route of candidateRoutes(line, network)) {
    for (const directionId of [0, 1] as const) {
      const stopIds = route.stopsByDirection[directionId];
      const boarding = findStop(stopIds, network, line.departureStopLocation, line.departureStop);
      if (boarding === null) continue;
      // the stops are in travel order, so in the direction the rider goes the alighting stop comes after the boarding one
      const after = stopIds.slice(stopIds.indexOf(boarding.stop.id) + 1);
      const alighting = findStop(after, network, line.arrivalStopLocation, line.arrivalStop);
      // a missing alighting stop counts as the farthest a match can be, so a direction with both wins
      const score = boarding.distance + (alighting?.distance ?? MAX_STOP_DISTANCE_METERS);
      if (best === null || score < best.score) {
        best = {
          routeId: route.id,
          directionId,
          boardingStopId: boarding.stop.id,
          alightingStopId: alighting?.stop.id ?? null,
          score,
        };
      }
    }
  }
  if (best === null) return null;
  const { score: _score, ...match } = best;
  return match;
}

// ---- alerts ----

/** Whether an alert is in effect at `now` (seconds since the epoch). No periods means always. */
function isActive(alert: Alert, now: number): boolean {
  if (alert.activePeriods.length === 0) return true;
  return alert.activePeriods.some((period) => (period.start ?? 0) <= now && (period.end === null || now < period.end));
}

/**
 * Whether one of an alert's selectors names this line. Its fields are ANDed, as GTFS-RT says. A selector must name
 * the line's route or one of its stops: one naming only the agency, a route type ("all buses") or a direction is
 * network-wide, like a Compass Card notice, and would put that alert on every trip.
 */
function selectorMatches(selector: InformedEntity, match: LineMatch, routeType: number, stopIds: ReadonlySet<string>): boolean {
  if (selector.routeId === null && selector.stopId === null) return false;
  if (selector.routeId !== null && selector.routeId !== match.routeId) return false;
  if (selector.routeType !== null && selector.routeType !== routeType) return false;
  if (selector.directionId !== null && selector.directionId !== match.directionId) return false;
  return selector.stopId === null || stopIds.has(selector.stopId);
}

/** A line's boarding and alighting stops, and the stations they're platforms of, which an alert may name instead. */
function lineStopIds(match: LineMatch, network: TranslinkStatic): Set<string> {
  const ids = new Set<string>();
  for (const id of [match.boardingStopId, match.alightingStopId]) {
    if (id === null) continue;
    ids.add(id);
    const parentId = network.stopsById.get(id)?.parentId;
    if (parentId !== null && parentId !== undefined) ids.add(parentId);
  }
  return ids;
}

/**
 * Finds the active alerts on a trip's lines.
 *
 * @param feed - TransLink's decoded service alerts feed.
 * @param matches - The trip's transit lines, matched with {@link matchLine}; null for one that didn't match.
 * @param network - TransLink's routes and stops.
 * @param now - The time, in seconds since the epoch.
 * @returns Each alert that is in effect and names one of the lines, their routes or their stops, in feed order.
 */
export function alertsForLines(
  feed: Feed,
  matches: readonly (LineMatch | null)[],
  network: TranslinkStatic,
  now: number,
): LineAlert[] {
  const lines = matches.map((match) => match === null ? null : {
    match,
    routeType: network.routes.find((route) => route.id === match.routeId)?.type ?? -1,
    stopIds: lineStopIds(match, network),
  });
  return feed.entities.flatMap((entity) => {
    const { alert } = entity;
    if (entity.deleted || alert === null || !isActive(alert, now)) return [];
    const lineIndexes = lines.flatMap((line, index) => line !== null &&
      alert.informedEntities.some((selector) => selectorMatches(selector, line.match, line.routeType, line.stopIds))
      ? [index]
      : []);
    return lineIndexes.length === 0 ? [] : [{ id: entity.id, alert, lineIndexes }];
  });
}

// ---- trip updates ----

/** An event's predicted time and delay, or null when it has no time. */
function timed(event: StopTimeEvent | null | undefined): { time: number; delay: number | null } | null {
  return event === null || event === undefined || event.time === null ? null : { time: event.time, delay: event.delay };
}

/** A run's predicted time at a stop, and its delay, from the stop's departure or else its arrival. */
function predictedAt(run: TripUpdate, stop: StopTimeUpdate | undefined): { time: number; delay: number | null } | null {
  const event = timed(stop?.departure) ?? timed(stop?.arrival);
  return event === null ? null : { time: event.time, delay: event.delay ?? run.delay };
}

/**
 * Finds TransLink's prediction for the run a line's rider planned to board.
 *
 * @remarks
 * The feed doesn't say which run the trip planned on, so this takes the run on the line's route and direction whose
 * scheduled departure from the boarding stop (predicted time minus delay) is closest to the trip's scheduled
 * departure, within {@link MAX_RUN_OFFSET_SECONDS}. Most of TransLink's runs give only a trip_id, so a run's route
 * comes from the static schedule when the feed leaves it out.
 *
 * @param feed - TransLink's decoded trip updates feed.
 * @param match - The line, matched with {@link matchLine}.
 * @param plannedDepartAt - When the trip planned to leave the boarding stop, from the line's `departAt`.
 * @param network - TransLink's routes, to find a run's route from its trip_id.
 * @returns The prediction, or null when no run in the feed is near the planned time.
 */
export function predictLine(
  feed: Feed,
  match: LineMatch,
  plannedDepartAt: Date,
  network: TranslinkStatic,
): LinePrediction | null {
  const planned = Math.floor(plannedDepartAt.getTime() / 1000);
  let best: { prediction: LinePrediction; offset: number } | null = null;
  for (const entity of feed.entities) {
    const run = entity.tripUpdate;
    if (entity.deleted || run === null) continue;
    if ((run.routeId ?? routeIdForTrip(network, run.tripId)) !== match.routeId) continue;
    if (run.directionId !== null && run.directionId !== match.directionId) continue;
    const boarding = run.stopTimeUpdates.find((update) => update.stopId === match.boardingStopId);
    const departure = predictedAt(run, boarding);
    if (departure === null) continue;
    const offset = Math.abs(departure.time - (departure.delay ?? 0) - planned);
    if (offset > MAX_RUN_OFFSET_SECONDS || (best !== null && offset >= best.offset)) continue;
    const alighting = run.stopTimeUpdates.find((update) => update.stopId === match.alightingStopId);
    const arrival = (timed(alighting?.arrival) ?? timed(alighting?.departure))?.time ?? null;
    best = {
      offset,
      prediction: {
        departAt: new Date(departure.time * 1000),
        arriveAt: arrival === null ? null : new Date(arrival * 1000),
        delaySeconds: departure.time - planned,
        cancelled: run.cancelled || boarding?.skipped === true,
      },
    };
  }
  return best?.prediction ?? null;
}
