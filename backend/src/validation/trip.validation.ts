import {
  MAX_LEGS,
  TRIP_MODES,
  type CostBreakdown,
  type Leg,
  type NewTrip,
  type Place,
  type TransitLine,
  type TripStatusChange,
} from '../models/trip.model';
import { isCoordinate, isOneOf, isRecord } from './common.validation';

const NEW_TRIP_STATUSES = ['PLANNED', 'ACTIVE'] as const;
const NEXT_TRIP_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;
const MAX_TEXT_LENGTH = 512; // longer than any place name, stop name or Google place ID
const MAX_POLYLINE_LENGTH = 20000; // far more than a route across Metro Vancouver encodes to
const MAX_TRANSIT_LINES = 5; // per leg, the lines a stop could be served by
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // how far ahead of the server a phone's clock may be
// ISO 8601 with a timezone, like the app's Instant.toString(), e.g. "2026-11-03T16:30:00Z",
// checked as a start and an end so neither pattern nests quantifiers (no ReDoS)
const MAX_DATE_LENGTH = 40;
const DATE_TIME_START = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const TIMEZONE_END = /(Z|[+-]\d{2}:\d{2})$/;

type Route = Pick<NewTrip, 'origin' | 'destination' | 'transferPoints' | 'legs'>;
type LegEnds = Pick<Leg, 'from' | 'to' | 'departAt' | 'arriveAt'>;
type LegMeasures = Pick<Leg, 'durationSeconds' | 'distanceMeters' | 'costCents' | 'polyline'>;
type Schedule = Pick<NewTrip, 'plannedStart' | 'plannedEnd'>;
type Totals = Pick<
  NewTrip,
  'totalDurationSeconds' | 'totalDistanceMeters' | 'totalCostCents' | 'costEstimated' | 'baselineDriveCostCents'
>;
type TransitDetails = Pick<TransitLine, 'colour' | 'headsign' | 'departureStop' | 'arrivalStop' | 'stopCount'>;

/** Checks a whole number of cents, metres, seconds or stops. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Checks a count that may be unknown. Missing or `null` means unknown. */
function parseOptionalCount(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  return isCount(value) ? value : undefined;
}

/** Checks a required name, like a place label or line name. */
function parseText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH ? value : undefined;
}

/** Checks text Google may leave out. Missing or `null` means it did. */
function parseOptionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value : undefined;
}

/** Checks an ISO 8601 time with a timezone. */
function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length > MAX_DATE_LENGTH) return undefined;
  if (!DATE_TIME_START.test(value) || !TIMEZONE_END.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date; // the patterns allow impossible dates like month 13
}

/** Checks a time that may be absent. Missing or `null` means there is none. */
function parseOptionalDate(value: unknown): Date | null | undefined {
  return value === undefined || value === null ? null : parseDate(value);
}

/**
 * Checks when the user started or ended a trip, as the app recorded it.
 * Missing means now, and a time too far in the future is refused.
 */
function parseEventTime(value: unknown, now: Date): Date | undefined {
  if (value === undefined || value === null) return now;
  const time = parseDate(value);
  return time !== undefined && time.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS ? time : undefined;
}

/** Checks a list of at most `max` items, each accepted by `parseItem`. */
function parseList<T>(value: unknown, max: number, parseItem: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined; // capped before parsing, so a huge list costs nothing
  const items: T[] = [];
  for (const item of value as unknown[]) {
    const parsed = parseItem(item);
    if (parsed === undefined) return undefined;
    items.push(parsed);
  }
  return items;
}

/** Checks a `{ label, lat, lng, placeId }` place. */
function parsePlace(value: unknown): Place | undefined {
  if (!isRecord(value)) return undefined;
  const { lat, lng } = value;
  const label = parseText(value.label);
  const placeId = parseOptionalText(value.placeId);
  if (label === undefined || placeId === undefined) return undefined;
  return isCoordinate(lat, MAX_LATITUDE) && isCoordinate(lng, MAX_LONGITUDE) ? { label, lat, lng, placeId } : undefined;
}

/** Checks the parts of a transit line Google may leave out. */
function parseTransitDetails(line: Record<string, unknown>): TransitDetails | undefined {
  const colour = parseOptionalText(line.colour);
  const headsign = parseOptionalText(line.headsign);
  const departureStop = parseOptionalText(line.departureStop);
  const arrivalStop = parseOptionalText(line.arrivalStop);
  const stopCount = parseOptionalCount(line.stopCount);
  if (colour === undefined || headsign === undefined || departureStop === undefined) return undefined;
  if (arrivalStop === undefined || stopCount === undefined) return undefined;
  return { colour, headsign, departureStop, arrivalStop, stopCount };
}

/** Checks one transit line a leg rides. */
function parseTransitLine(value: unknown): TransitLine | undefined {
  if (!isRecord(value)) return undefined;
  const name = parseText(value.name);
  const vehicle = parseText(value.vehicle);
  const details = parseTransitDetails(value);
  return name !== undefined && vehicle !== undefined && details !== undefined ? { name, vehicle, ...details } : undefined;
}

/** Checks where and when a leg starts and ends. */
function parseLegEnds(leg: Record<string, unknown>): LegEnds | undefined {
  const from = parsePlace(leg.from);
  const to = parsePlace(leg.to);
  const departAt = parseDate(leg.departAt);
  const arriveAt = parseDate(leg.arriveAt);
  if (from === undefined || to === undefined || departAt === undefined || arriveAt === undefined) return undefined;
  return { from, to, departAt, arriveAt };
}

/** Checks a leg's duration, distance, cost and encoded route. */
function parseLegMeasures(leg: Record<string, unknown>): LegMeasures | undefined {
  const { durationSeconds, distanceMeters, costCents, polyline } = leg;
  if (!isCount(durationSeconds) || !isCount(distanceMeters) || !isCount(costCents)) return undefined;
  if (typeof polyline !== 'string' || polyline.length === 0 || polyline.length > MAX_POLYLINE_LENGTH) return undefined;
  return { durationSeconds, distanceMeters, costCents, polyline };
}

/** Checks one leg of a route. */
function parseLeg(value: unknown): Leg | undefined {
  if (!isRecord(value) || !isOneOf(TRIP_MODES, value.mode)) return undefined;
  const ends = parseLegEnds(value);
  const measures = parseLegMeasures(value);
  const transitLines = parseList(value.transitLines, MAX_TRANSIT_LINES, parseTransitLine);
  if (ends === undefined || measures === undefined || transitLines === undefined) return undefined;
  return { mode: value.mode, ...ends, ...measures, transitLines };
}

/** Checks the legs and transfer points, and takes the trip's origin and destination from its first and last legs. */
function parseRoute(option: Record<string, unknown>): Route | undefined {
  const legs = parseList(option.legs, MAX_LEGS, parseLeg);
  const transferPoints = parseList(option.transferPoints, MAX_LEGS, parsePlace);
  const first = legs?.at(0);
  const last = legs?.at(-1);
  if (legs === undefined || transferPoints === undefined || first === undefined || last === undefined) return undefined;
  return { origin: first.from, destination: last.to, transferPoints, legs };
}

/** Checks the route's leave and arrive times. */
function parseSchedule(option: Record<string, unknown>): Schedule | undefined {
  const plannedStart = parseDate(option.leaveAt);
  const plannedEnd = parseDate(option.arriveAt);
  if (plannedStart === undefined || plannedEnd === undefined) return undefined;
  return plannedStart.getTime() <= plannedEnd.getTime() ? { plannedStart, plannedEnd } : undefined;
}

/** Checks the route's totals. Whether they add up to its legs is checked when the trip is saved. */
function parseTotals(option: Record<string, unknown>): Totals | undefined {
  const { totalDurationSeconds, totalDistanceMeters, totalCostCents, costEstimated } = option;
  const baselineDriveCostCents = parseOptionalCount(option.baselineDriveCostCents);
  if (!isCount(totalDurationSeconds) || !isCount(totalDistanceMeters) || !isCount(totalCostCents)) return undefined;
  if (typeof costEstimated !== 'boolean' || baselineDriveCostCents === undefined) return undefined;
  return { totalDurationSeconds, totalDistanceMeters, totalCostCents, costEstimated, baselineDriveCostCents };
}

/** Checks the `{ fuelCents, parkingCents, fareCents }` cost split. */
function parseCostBreakdown(value: unknown): CostBreakdown | undefined {
  if (!isRecord(value)) return undefined;
  const { fuelCents, parkingCents, fareCents } = value;
  return isCount(fuelCents) && isCount(parkingCents) && isCount(fareCents) ? { fuelCents, parkingCents, fareCents } : undefined;
}

/** Checks a `RouteOption` from the Planner (see issue #70), keeping only the fields a trip stores. */
function parseRouteOption(value: unknown): Omit<NewTrip, 'status' | 'arriveBy' | 'actualStart'> | undefined {
  if (!isRecord(value)) return undefined;
  const route = parseRoute(value);
  const schedule = parseSchedule(value);
  const totals = parseTotals(value);
  const costBreakdown = parseCostBreakdown(value.costBreakdown);
  if (route === undefined || schedule === undefined || totals === undefined || costBreakdown === undefined) return undefined;
  return { ...route, ...schedule, ...totals, costBreakdown };
}

/**
 * Checks a planned route the app saves as a trip.
 *
 * @remarks
 * The body is `{ option, status, arriveBy?, actualStart? }`:
 * - `option`: a `RouteOption` from `POST /api/routes/plan` (see issue #70), with 1 to 8 legs.
 *   Its `label`, `lateByMinutes` and `transfers` are ignored, since a trip doesn't store them.
 * - `status`: `"PLANNED"` (Save for later) or `"ACTIVE"` (Start).
 * - `arriveBy`: an ISO 8601 time, or missing or `null` for "leave now".
 * - `actualStart`: when an ACTIVE trip started, defaulting to now. Ignored for PLANNED trips.
 *
 * Only these fields are read, so nothing else in the body (like `userId`) can reach the database.
 * Whether the totals add up to the legs is left to the trip model, so the rule lives in one place.
 *
 * @param body - The raw request body.
 * @param now - The current time, for defaulting and checking `actualStart`.
 * @returns The trip to save, or `undefined` if any field is missing or invalid.
 */
export function parseNewTrip(body: unknown, now = new Date()): NewTrip | undefined {
  if (!isRecord(body)) return undefined;
  const { status } = body;
  if (!isOneOf(NEW_TRIP_STATUSES, status)) return undefined;
  const option = parseRouteOption(body.option);
  const arriveBy = parseOptionalDate(body.arriveBy);
  const actualStart = status === 'ACTIVE' ? parseEventTime(body.actualStart, now) : null; // a planned trip hasn't started
  if (option === undefined || arriveBy === undefined || actualStart === undefined) return undefined;
  return { ...option, status, arriveBy, actualStart };
}

/**
 * Checks a status change for a saved trip.
 *
 * @remarks
 * The body is `{ status, actualStart?, actualEnd? }`:
 * - `status`: `"ACTIVE"` (start a planned trip), `"COMPLETED"` or `"CANCELLED"` (end an active one).
 * - `actualStart` when starting, or `actualEnd` when ending: an ISO 8601 time from the app,
 *   defaulting to now and at most 5 minutes ahead of the server.
 *
 * Whether the trip may move to this status, and whether it ends after it started, needs the stored
 * trip, so the service checks those.
 *
 * @param body - The raw request body.
 * @param now - The current time, for defaulting and checking the time.
 * @returns The change to make, or `undefined` if the status or time is invalid.
 */
export function parseStatusChange(body: unknown, now = new Date()): TripStatusChange | undefined {
  if (!isRecord(body)) return undefined;
  const { status } = body;
  if (!isOneOf(NEXT_TRIP_STATUSES, status)) return undefined;
  const at = parseEventTime(status === 'ACTIVE' ? body.actualStart : body.actualEnd, now);
  return at === undefined ? undefined : { status, at };
}
