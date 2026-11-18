import type { ParkingSpot, Transit, User, Vehicle } from '../models/user.model';
import { DEFAULT_GAS_CENTS_PER_LITRE, DEFAULT_LITRES_PER_100KM, singleTransitFareCents } from './planner.constants';

export interface PlannerPlace {
  label: string;
  lat: number;
  lng: number;
  placeId: string | null;
}

export interface CandidateSpot extends Pick<ParkingSpot, 'label' | 'location' | 'placeId' | 'rateCents' | 'ratePer' | 'overnightAllowed'> {
  _id?: unknown;
}

export interface ScheduledChain {
  leaveAt: Date;
  driveArriveAt: Date;
  transitDepartAt: Date;
  arriveAt: Date;
  lateByMinutes: number;
}

export interface CostBreakdown {
  fuelCents: number;
  parkingCents: number;
  fareCents: number;
}

export interface PricedChain {
  spotId: string;
  totalDurationSeconds: number;
  totalDistanceMeters: number;
  totalCostCents: number;
  costBreakdown: CostBreakdown;
  costEstimated: boolean;
  score: number;
}

export interface CandidateRoute extends PricedChain {
  label: 'CHEAPEST' | 'FASTEST' | 'BALANCED';
  leaveAt: Date;
  arriveAt: Date;
  lateByMinutes: number;
  parkedFromAt: Date;
  overnightAllowed: boolean;
  transferPoint: PlannerPlace | null;
  walkSeconds: number;
}

/** A time, cost and score that a spot's real chain can never beat, or a baseline's screened values. */
export interface ChainEstimate {
  durationSeconds: number;
  costCents: number;
  score: number;
}

/** The fields of a detailed route that choosing among Google's alternatives needs. */
export interface RouteChoice {
  durationSeconds: number;
  longestWalkSeconds: number;
  transitLines: readonly unknown[];
}

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_CANDIDATES = 8;
const MAX_WALK_SECONDS = 10 * 60;
const PARKING_BUFFER_SECONDS = 5 * 60;
const KM_PER_HOUR_TO_METERS_PER_SECOND = 1000 / 3600;
// No Metro Vancouver transit trip can cover straight-line distance faster than its fastest vehicle. The fastest is
// the West Coast Express, at 110 km/h top speed (https://en.wikipedia.org/wiki/West_Coast_Express, checked
// 2026-11-15). 120 km/h sits above it, so a bound built on it never overestimates a real transit time.
export const MAX_TRANSIT_SPEED_METERS_PER_SECOND = 120 * KM_PER_HOUR_TO_METERS_PER_SECOND;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceMeters(a: PlannerPlace | CandidateSpot['location'], b: PlannerPlace | CandidateSpot['location']): number {
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b.lng - a.lng);
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

function distanceToLineMeters(point: CandidateSpot['location'], origin: PlannerPlace, destination: PlannerPlace): number {
  const originLat = radians(origin.lat);
  const scaleX = EARTH_RADIUS_METERS * Math.cos(originLat);
  const scaleY = EARTH_RADIUS_METERS;
  const px = radians(point.lng - origin.lng) * scaleX;
  const py = radians(point.lat - origin.lat) * scaleY;
  const dx = radians(destination.lng - origin.lng) * scaleX;
  const dy = radians(destination.lat - origin.lat) * scaleY;
  const lineLengthSquared = dx * dx + dy * dy;
  const projection = lineLengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lineLengthSquared));
  return Math.hypot(px - projection * dx, py - projection * dy);
}

/** Selects the eight closest-to-line saved spots whose detour fits the 1.4x ellipse. */
export function selectCandidates(
  origin: PlannerPlace,
  destination: PlannerPlace,
  spots: readonly CandidateSpot[],
): CandidateSpot[] {
  const directDistance = distanceMeters(origin, destination);
  return spots
    .filter((spot) => distanceMeters(origin, spot.location) + distanceMeters(spot.location, destination) <= directDistance * 1.4)
    .map((spot) => ({ spot, distance: distanceToLineMeters(spot.location, origin, destination) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_CANDIDATES)
    .map(({ spot }) => spot);
}

/** Schedules a Drive -> Transit chain from its deadline, or starts it now when there is no deadline. */
export function scheduleChain(
  driveSeconds: number,
  transitSeconds: number,
  arriveBy: Date | null,
  now: Date,
): ScheduledChain {
  const totalTravelSeconds = driveSeconds + PARKING_BUFFER_SECONDS + transitSeconds;
  if (arriveBy === null) {
    const leaveAt = new Date(now);
    const driveArriveAt = new Date(leaveAt.getTime() + driveSeconds * 1000);
    const transitDepartAt = new Date(driveArriveAt.getTime() + PARKING_BUFFER_SECONDS * 1000);
    const arriveAt = new Date(transitDepartAt.getTime() + transitSeconds * 1000);
    return { leaveAt, driveArriveAt, transitDepartAt, arriveAt, lateByMinutes: 0 };
  }

  const plannedLeave = new Date(arriveBy.getTime() - totalTravelSeconds * 1000);
  const leaveAt = plannedLeave < now ? new Date(now) : plannedLeave;
  const driveArriveAt = new Date(leaveAt.getTime() + driveSeconds * 1000);
  const transitDepartAt = new Date(driveArriveAt.getTime() + PARKING_BUFFER_SECONDS * 1000);
  const arriveAt = new Date(transitDepartAt.getTime() + transitSeconds * 1000);
  return {
    leaveAt,
    driveArriveAt,
    transitDepartAt,
    arriveAt,
    lateByMinutes: Math.max(0, Math.ceil((arriveAt.getTime() - arriveBy.getTime()) / 60_000)),
  };
}

/** Prices a chain using user values, with regional defaults when vehicle or gas data is missing. */
export function priceChain(input: {
  driveDistanceMeters: number;
  transitDistanceMeters: number;
  totalDurationSeconds: number;
  parkedSeconds: number;
  spot: CandidateSpot;
  vehicle: Vehicle | null;
  gasCentsPerLitre: number | null;
  transit: Transit | null;
  transitZones: number;
  costVsTime: number;
  includeFare?: boolean;
  includeFuel?: boolean;
}): Omit<PricedChain, 'spotId'> {
  const litresPer100km = input.vehicle?.litresPer100km ?? DEFAULT_LITRES_PER_100KM;
  const gasCentsPerLitre = input.gasCentsPerLitre ?? DEFAULT_GAS_CENTS_PER_LITRE;
  const fuelCents = input.includeFuel === false
    ? 0
    : Math.round((input.driveDistanceMeters / 100_000) * litresPer100km * gasCentsPerLitre);
  const parkingCents = input.spot.rateCents === null
    ? 0
    : input.spot.ratePer === 'DAY'
      ? input.spot.rateCents
      : input.spot.ratePer === 'HOUR'
        ? input.spot.rateCents * Math.ceil(input.parkedSeconds / 3600)
        : 0;
  const fareCents = input.includeFare === false ? 0 : singleTransitFareCents(input.transit, input.transitZones);
  const totalCostCents = fuelCents + parkingCents + fareCents;
  const costEstimated = (input.includeFuel !== false && (input.vehicle === null || input.gasCentsPerLitre === null)) ||
    (input.includeFare !== false && input.transit === null) ||
    input.spot.rateCents === null;
  const score = totalCostCents + (input.costVsTime * input.totalDurationSeconds) / 60;
  return {
    totalDurationSeconds: input.totalDurationSeconds,
    totalDistanceMeters: input.driveDistanceMeters + input.transitDistanceMeters,
    totalCostCents,
    costBreakdown: { fuelCents, parkingCents, fareCents },
    costEstimated,
    score,
  };
}

/** The fewest seconds any transit trip from [spot] to [destination] could take: straight-line distance at top speed. */
export function transitLowerBoundSeconds(spot: CandidateSpot['location'], destination: PlannerPlace): number {
  return distanceMeters(spot, destination) / MAX_TRANSIT_SPEED_METERS_PER_SECOND;
}

/**
 * The best time, cost and score a Drive -> Transit chain through [spot] could reach, before its transit leg is priced.
 * The drive is already known; the transit ride is at its lower bound, parking covers only that ride, and the fare is
 * the one-zone minimum, so every term is a floor.
 */
export function chainLowerBound(input: {
  driveSeconds: number;
  driveMeters: number;
  spot: CandidateSpot;
  destination: PlannerPlace;
  user: Pick<User, 'vehicle' | 'transit' | 'lastGasPrice'>;
  costVsTime: number;
}): ChainEstimate {
  const transitSeconds = transitLowerBoundSeconds(input.spot.location, input.destination);
  const price = priceChain({
    driveDistanceMeters: input.driveMeters,
    transitDistanceMeters: 0,
    totalDurationSeconds: input.driveSeconds + PARKING_BUFFER_SECONDS + transitSeconds,
    parkedSeconds: PARKING_BUFFER_SECONDS + transitSeconds,
    spot: input.spot,
    vehicle: input.user.vehicle,
    gasCentsPerLitre: input.user.lastGasPrice?.centsPerLitre ?? null,
    transit: input.user.transit,
    transitZones: 1,
    costVsTime: input.costVsTime,
  });
  return { durationSeconds: price.totalDurationSeconds, costCents: price.totalCostCents, score: price.score };
}

/**
 * Keeps the spots that could still win: a spot is dropped only when some baseline is strictly faster and scores
 * strictly better than its bound, and the transit-only baseline is strictly cheaper. Drive-only's cost leaves out
 * parking at the destination, so it isn't a fair cost reference; with no transit-only baseline nothing is dropped.
 * The spot with the best bound score is always kept, so Balanced still has a chain to choose.
 */
export function pruneSpots<T extends ChainEstimate>(
  bounds: readonly T[],
  baselines: readonly ChainEstimate[],
  costReferenceCents: number | null,
): T[] {
  if (costReferenceCents === null || bounds.length === 0) return [...bounds];
  const best = bounds.reduce((winner, bound) => (bound.score < winner.score ? bound : winner));
  return bounds.filter((bound) => bound === best || !(
    costReferenceCents < bound.costCents &&
    baselines.some((baseline) => baseline.durationSeconds < bound.durationSeconds && baseline.score < bound.score)
  ));
}

/** The shortest of Google's alternative routes whose longest walk fits [maxWalkSeconds]; ties go to fewer lines. */
export function chooseRoute<T extends RouteChoice>(routes: readonly T[], maxWalkSeconds: number): T | null {
  const fitting = routes
    .filter((route) => route.longestWalkSeconds <= maxWalkSeconds)
    .sort((a, b) => a.durationSeconds - b.durationSeconds || a.transitLines.length - b.transitLines.length);
  return fitting[0] ?? null;
}

/** Drops impossible chains while retaining their spot-specific constraints. */
export function filterChains<T extends CandidateRoute>(chains: readonly T[], now: Date, timezone = 'UTC'): T[] {
  const localDate = (date: Date): string => new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return chains.filter((chain) => {
    if (chain.leaveAt < now || chain.walkSeconds > MAX_WALK_SECONDS) return false;
    if (!chain.overnightAllowed && localDate(chain.parkedFromAt) !== localDate(chain.arriveAt)) return false;
    return true;
  });
}

/** Picks distinct routes for Cheapest, Fastest and Balanced; returns fewer when candidates run out. */
export function pickThree<T extends CandidateRoute>(chains: readonly T[]): T[] {
  if (chains.length === 0) return [];
  const onTime = chains.filter((chain) => chain.lateByMinutes === 0);
  if (onTime.length === 0) {
    const earliest = [...chains].sort((a, b) => a.arriveAt.getTime() - b.arriveAt.getTime())[0];
    return earliest === undefined ? [] : [{ ...earliest, label: 'FASTEST' }];
  }
  const selected: T[] = [];
  const remaining = [...onTime];
  const choose = (label: CandidateRoute['label'], compare: (a: T, b: T) => number): void => {
    const candidate = remaining.sort(compare).find((route) => !selected.some((picked) => picked.spotId === route.spotId));
    if (candidate !== undefined) {
      selected.push({ ...candidate, label });
      remaining.splice(remaining.indexOf(candidate), 1);
    }
  };
  choose('CHEAPEST', (a, b) => a.totalCostCents - b.totalCostCents || a.arriveAt.getTime() - b.arriveAt.getTime());
  choose('FASTEST', (a, b) => a.totalDurationSeconds - b.totalDurationSeconds || a.totalCostCents - b.totalCostCents);
  choose('BALANCED', (a, b) => a.score - b.score || a.totalCostCents - b.totalCostCents);
  return selected;
}

/** Refines a screened chain schedule with exact departure and arrival timestamps from route details. */
export function scheduleDetailedChain(
  driveSeconds: number,
  transitSeconds: number,
  transitDepartAt: Date | null,
  transitArriveAt: Date | null,
  arriveBy: Date | null,
  now: Date,
): ScheduledChain {
  const estimated = scheduleChain(driveSeconds, transitSeconds, arriveBy, now);
  if (
    transitDepartAt === null || transitArriveAt === null ||
    Number.isNaN(transitDepartAt.getTime()) || Number.isNaN(transitArriveAt.getTime()) ||
    transitArriveAt < transitDepartAt
  ) return estimated;

  const driveArriveAt = new Date(transitDepartAt.getTime() - PARKING_BUFFER_SECONDS * 1000);
  const plannedLeaveAt = new Date(driveArriveAt.getTime() - driveSeconds * 1000);
  if (arriveBy !== null) {
    if (plannedLeaveAt < now) return estimated;
    return {
      leaveAt: plannedLeaveAt,
      driveArriveAt,
      transitDepartAt,
      arriveAt: transitArriveAt,
      lateByMinutes: Math.max(0, Math.ceil((transitArriveAt.getTime() - arriveBy.getTime()) / 60_000)),
    };
  }

  if (transitDepartAt < estimated.transitDepartAt) return estimated;
  return {
    ...estimated,
    transitDepartAt,
    arriveAt: transitArriveAt,
  };
}

/** Refines a direct baseline's schedule with its exact route-detail timestamps when available. */
export function scheduleDetailedSingle(
  durationSeconds: number,
  departAt: Date | null,
  arriveAt: Date | null,
  arriveBy: Date | null,
  now: Date,
): ScheduledChain {
  const leaveAt = arriveBy === null || arriveBy.getTime() - durationSeconds * 1000 < now.getTime()
    ? new Date(now)
    : new Date(arriveBy.getTime() - durationSeconds * 1000);
  const estimatedArriveAt = new Date(leaveAt.getTime() + durationSeconds * 1000);
  const validTimes = departAt !== null && arriveAt !== null &&
    !Number.isNaN(departAt.getTime()) && !Number.isNaN(arriveAt.getTime()) &&
    departAt >= now && arriveAt >= departAt;
  const exactLeaveAt = validTimes ? departAt : leaveAt;
  const exactArriveAt = validTimes ? arriveAt : estimatedArriveAt;
  return {
    leaveAt: exactLeaveAt,
    driveArriveAt: exactLeaveAt,
    transitDepartAt: exactLeaveAt,
    arriveAt: exactArriveAt,
    lateByMinutes: arriveBy === null ? 0 : Math.max(0, Math.ceil((exactArriveAt.getTime() - arriveBy.getTime()) / 60_000)),
  };
}

export type BikeTransitOrder = 'BIKE_TRANSIT' | 'TRANSIT_BIKE';

export interface BikeTransitSchedule extends ScheduledChain {
  bikeDepartAt: Date;
  bikeArriveAt: Date;
  transitDepartAt: Date;
  transitArriveAt: Date;
}

/** Schedules a single bicycle/transit transfer while keeping its buffer out of the walking-time calculation. */
export function scheduleBikeTransit(
  order: BikeTransitOrder,
  bicycleSeconds: number,
  transitSeconds: number,
  transitDepartAt: Date | null,
  transitArriveAt: Date | null,
  arriveBy: Date | null,
  now: Date,
  transferBufferSeconds: number,
): BikeTransitSchedule | null {
  const validTime = (time: Date | null): time is Date => time !== null && !Number.isNaN(time.getTime());
  const totalSeconds = bicycleSeconds + transitSeconds + transferBufferSeconds;
  const estimatedLeaveAt = arriveBy !== null && arriveBy.getTime() - totalSeconds * 1000 >= now.getTime()
    ? new Date(arriveBy.getTime() - totalSeconds * 1000)
    : new Date(now);

  if (order === 'BIKE_TRANSIT') {
    const transitDeparture = validTime(transitDepartAt)
      ? transitDepartAt
      : new Date(estimatedLeaveAt.getTime() + (bicycleSeconds + transferBufferSeconds) * 1000);
    const transitArrival = validTime(transitArriveAt)
      ? transitArriveAt
      : new Date(transitDeparture.getTime() + transitSeconds * 1000);
    const bikeArriveAt = new Date(transitDeparture.getTime() - transferBufferSeconds * 1000);
    const bikeDepartAt = new Date(bikeArriveAt.getTime() - bicycleSeconds * 1000);
    if (bikeDepartAt < now || transitArrival < transitDeparture) return null;
    return {
      leaveAt: bikeDepartAt,
      driveArriveAt: bikeArriveAt,
      transitDepartAt: transitDeparture,
      arriveAt: transitArrival,
      lateByMinutes: arriveBy === null ? 0 : Math.max(0, Math.ceil((transitArrival.getTime() - arriveBy.getTime()) / 60_000)),
      bikeDepartAt,
      bikeArriveAt,
      transitArriveAt: transitArrival,
    };
  }

  const transitArrival = validTime(transitArriveAt)
    ? transitArriveAt
    : new Date(estimatedLeaveAt.getTime() + transitSeconds * 1000);
  const transitDeparture = validTime(transitDepartAt)
    ? transitDepartAt
    : new Date(transitArrival.getTime() - transitSeconds * 1000);
  const bikeDepartAt = new Date(transitArrival.getTime() + transferBufferSeconds * 1000);
  const bikeArriveAt = new Date(bikeDepartAt.getTime() + bicycleSeconds * 1000);
  if (transitDeparture < now || transitArrival < transitDeparture) return null;
  return {
    leaveAt: transitDeparture,
    driveArriveAt: transitArrival,
    transitDepartAt: transitDeparture,
    arriveAt: bikeArriveAt,
    lateByMinutes: arriveBy === null ? 0 : Math.max(0, Math.ceil((bikeArriveAt.getTime() - arriveBy.getTime()) / 60_000)),
    bikeDepartAt,
    bikeArriveAt,
    transitArriveAt: transitArrival,
  };
}