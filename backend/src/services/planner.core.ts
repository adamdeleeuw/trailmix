import type { ParkingSpot, Transit, Vehicle } from '../models/user.model';
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

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_CANDIDATES = 8;
const MAX_WALK_SECONDS = 10 * 60;
const PARKING_BUFFER_SECONDS = 5 * 60;

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