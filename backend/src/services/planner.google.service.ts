import { env } from '../config/env';
import type { NavigationStep, StopLocation } from '../models/trip.model';
import type { PlannerPlace } from './planner.core';

export type PlannerMode = 'DRIVE' | 'TRANSIT' | 'BICYCLE';

export interface MatrixElement {
  originIndex: number;
  destinationIndex: number;
  durationSeconds: number;
  distanceMeters: number;
}

export interface TransitLineDetail {
  name: string;
  shortName: string; // what the line is signed as, e.g. "99" or "R4"; '' when it has none (SkyTrain lines)
  vehicle: string;
  colour: string;
  headsign: string;
  departureStop: string;
  arrivalStop: string;
  stopCount: number;
  // where the stops are and the scheduled times there, which LiveUpdates matches to TransLink's stops and runs; null
  // when Google leaves them out. A leg's own from, to and times can include a walk merged into it, so they aren't these
  departureStopLocation: StopLocation | null;
  arrivalStopLocation: StopLocation | null;
  departAt: string | null;
  arriveAt: string | null;
}

export interface RouteDetail {
  durationSeconds: number;
  distanceMeters: number;
  polyline: string;
  departAt: string;
  arriveAt: string;
  transitLines: TransitLineDetail[];
  walkSeconds: number;
  longestWalkSeconds: number; // the longest stretch of back-to-back walking steps, checked against the user's max walk
  steps: RouteStepDetail[];
  navigation: NavigationStep[]; // turn-by-turn for every driving or walking step, in order
}

export interface RouteStepDetail {
  mode: 'TRANSIT' | 'WALK';
  durationSeconds: number;
  distanceMeters: number;
  polyline: string;
  from: { label: string; lat: number; lng: number };
  to: { label: string; lat: number; lng: number };
  departAt: string;
  arriveAt: string;
  transitLine: TransitLineDetail | null;
  navigation: NavigationStep[]; // a walking step's own instruction, empty for a transit step
}

export class RouteServiceUnavailableError extends Error {}

const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const DETAILS_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TIMEOUT_MS = 10_000;
const MAX_CALLS_IN_FLIGHT = 20; // bounds what a burst of plans can send Google at once
const SLOT_WAIT_MS = 2_000;
const FIRST_SERVER_ERROR = 500;
const MATRIX_FIELD_MASK = 'originIndex,destinationIndex,duration,distanceMeters,condition,status';
const DETAILS_FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.color',
  'routes.legs.steps.transitDetails.transitLine.vehicle.name',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
  'routes.legs.steps.transitDetails.headsign',
  'routes.legs.steps.transitDetails.stopDetails',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.polyline.encodedPolyline',
  'routes.legs.steps.startLocation.latLng',
  'routes.legs.steps.endLocation.latLng',
  'routes.legs.steps.navigationInstruction',
].join(',');

function waypoint(place: Pick<PlannerPlace, 'lat' | 'lng'>): object {
  return { location: { latLng: { latitude: place.lat, longitude: place.lng } } };
}

function seconds(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?s$/.test(value)) return undefined;
  return Math.round(Number.parseFloat(value));
}

function isoTimestamp(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

let callsInFlight = 0;
const waitingForSlot: (() => void)[] = [];

// waits up to SLOT_WAIT_MS for one of the MAX_CALLS_IN_FLIGHT slots, then gives up with the usual 503
function takeSlot(): Promise<void> {
  if (callsInFlight < MAX_CALLS_IN_FLIGHT) {
    callsInFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const handOver = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      waitingForSlot.splice(waitingForSlot.indexOf(handOver), 1);
      reject(new RouteServiceUnavailableError('No free slot for a Google Routes API call'));
    }, SLOT_WAIT_MS);
    waitingForSlot.push(handOver);
  });
}

// gives the slot to the longest waiting call, or frees it
function releaseSlot(): void {
  const next = waitingForSlot.shift();
  if (next === undefined) callsInFlight -= 1;
  else next();
}

async function postGoogle<T>(url: string, fieldMask: string, body: object): Promise<T> {
  await takeSlot();
  try {
    return await postWithRetry<T>(url, fieldMask, body);
  } finally {
    releaseSlot();
  }
}

// retries once after a timeout, a network error or a 5xx; a 4xx (bad request, key or quota) would fail again
async function postWithRetry<T>(url: string, fieldMask: string, body: object): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.googleRoutesApiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return (await response.json()) as T;
      lastError = new Error(`Routes API responded ${response.status}`);
      if (response.status < FIRST_SERVER_ERROR) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw new RouteServiceUnavailableError('Could not reach Google Routes API', { cause: lastError });
}

/** Queries an origin/destination matrix and omits elements where Google found no route. */
export async function computeRouteMatrix(
  origins: readonly PlannerPlace[],
  destinations: readonly PlannerPlace[],
  mode: PlannerMode,
  time: { departureTime?: string; arrivalTime?: string } = {},
): Promise<MatrixElement[]> {
  const response = await postGoogle<unknown>(MATRIX_URL, MATRIX_FIELD_MASK, {
    origins: origins.map((place) => ({ waypoint: waypoint(place) })),
    destinations: destinations.map((place) => ({ waypoint: waypoint(place) })),
    travelMode: mode,
    ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    ...time,
  });
  if (!Array.isArray(response)) return [];
  return response.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const element = item as Record<string, unknown>;
    const durationSeconds = seconds(element.duration);
    if (
      element.condition !== 'ROUTE_EXISTS' ||
      typeof element.originIndex !== 'number' ||
      typeof element.destinationIndex !== 'number' ||
      durationSeconds === undefined
    ) return [];
    return [{
      originIndex: element.originIndex,
      destinationIndex: element.destinationIndex,
      durationSeconds,
      distanceMeters: typeof element.distanceMeters === 'number' ? Math.round(element.distanceMeters) : 0,
    }];
  });
}

interface GoogleDetailsResponse {
  routes?: {
    duration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
    legs?: {
      steps?: {
        travelMode?: string;
        staticDuration?: string;
        distanceMeters?: number;
        polyline?: { encodedPolyline?: string };
        startLocation?: { latLng?: { latitude?: number; longitude?: number } };
        endLocation?: { latLng?: { latitude?: number; longitude?: number } };
        navigationInstruction?: { maneuver?: string; instructions?: string };
        transitDetails?: {
          headsign?: string;
          stopDetails?: {
            departureStop?: GoogleStop;
            arrivalStop?: GoogleStop;
            stopCount?: number;
            departureTime?: string;
            arrivalTime?: string;
          };
          transitLine?: {
            name?: string;
            nameShort?: string;
            vehicle?: { name?: string; type?: string };
            color?: string;
          };
        };
      }[];
    }[];
  }[];
}

interface GoogleStop {
  name?: string;
  location?: { latLng?: { latitude?: number; longitude?: number } };
}

type GoogleStep = NonNullable<NonNullable<NonNullable<GoogleDetailsResponse['routes']>[number]['legs']>[number]['steps']>[number];
type GoogleTransitDetails = NonNullable<GoogleStep['transitDetails']>;

/** Reads a driving or walking step's turn-by-turn instruction, or none when Google gave no text or place for it. */
function toNavigationSteps(step: GoogleStep): NavigationStep[] {
  const instruction = step.navigationInstruction?.instructions;
  const start = step.startLocation?.latLng;
  if (step.travelMode === 'TRANSIT' || instruction === undefined || instruction === '') return [];
  if (start?.latitude === undefined || start.longitude === undefined) return [];
  return [{
    instruction,
    maneuver: step.navigationInstruction?.maneuver ?? 'MANEUVER_UNSPECIFIED', // Google's own name for "no arrow"
    lat: start.latitude,
    lng: start.longitude,
  }];
}

function toTransitLine(details: GoogleTransitDetails): TransitLineDetail {
  return {
    name: details.transitLine?.name ?? '',
    shortName: details.transitLine?.nameShort ?? '',
    vehicle: details.transitLine?.vehicle?.name ?? details.transitLine?.vehicle?.type ?? '',
    colour: details.transitLine?.color ?? '',
    headsign: details.headsign ?? '',
    departureStop: details.stopDetails?.departureStop?.name ?? '',
    arrivalStop: details.stopDetails?.arrivalStop?.name ?? '',
    stopCount: details.stopDetails?.stopCount ?? 0,
    departureStopLocation: stopLocation(details.stopDetails?.departureStop),
    arrivalStopLocation: stopLocation(details.stopDetails?.arrivalStop),
    departAt: isoTimestamp(details.stopDetails?.departureTime) ?? null,
    arriveAt: isoTimestamp(details.stopDetails?.arrivalTime) ?? null,
  };
}

/** Where Google says a transit stop is, or null when it leaves the location out. */
function stopLocation(stop: GoogleStop | undefined): StopLocation | null {
  const latLng = stop?.location?.latLng;
  if (latLng?.latitude === undefined || latLng.longitude === undefined) return null;
  return { lat: latLng.latitude, lng: latLng.longitude };
}

/** The longest run of back-to-back walking steps, in seconds; riding a vehicle ends a run. */
export function longestWalkSeconds(steps: readonly { travelMode?: string; staticDuration?: string }[]): number {
  let longest = 0;
  let current = 0;
  for (const step of steps) {
    if (step.travelMode === 'WALK') {
      current += seconds(step.staticDuration) ?? 0;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

type GoogleRoute = NonNullable<GoogleDetailsResponse['routes']>[number];
interface RouteTime { departureTime?: string; arrivalTime?: string }

/**
 * Retrieves full route geometry and transit labels for one planned leg. A transit request also asks Google for its
 * alternative routes, so the Planner can pick one that fits the user's max walk; every route that parses is returned.
 */
export async function computeRouteDetails(
  origin: PlannerPlace,
  destination: PlannerPlace,
  mode: PlannerMode,
  time: RouteTime,
): Promise<RouteDetail[]> {
  const response = await postGoogle<GoogleDetailsResponse>(DETAILS_URL, DETAILS_FIELD_MASK, {
    origin: waypoint(origin),
    destination: waypoint(destination),
    travelMode: mode,
    ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : { computeAlternativeRoutes: true }),
    ...time,
  });
  return (response.routes ?? []).flatMap((route) => {
    const detail = toRouteDetail(route, time);
    return detail === null ? [] : [detail];
  });
}

/** Parses one Google route into a RouteDetail, or null when it has no duration or geometry. */
function toRouteDetail(route: GoogleRoute, time: RouteTime): RouteDetail | null {
  const durationSeconds = seconds(route.duration);
  const polyline = route.polyline?.encodedPolyline;
  if (durationSeconds === undefined || polyline === undefined) return null;


  const transitLines = (route.legs ?? []).flatMap((leg) => leg.steps ?? []).flatMap((step) => {
    const details = step.transitDetails;
    if (step.travelMode !== 'TRANSIT' || details === undefined) return [];
    return [toTransitLine(details)];
  });
  const walkSeconds = (route.legs ?? []).flatMap((leg) => leg.steps ?? []).reduce((total, step) => {
    if (step.travelMode !== 'WALK') return total;
    return total + (seconds(step.staticDuration) ?? 0);
  }, 0);
  let departAt = isoTimestamp(time.departureTime);
  let arriveAt = isoTimestamp(time.arrivalTime);
  if (departAt === undefined && arriveAt !== undefined) {
    departAt = new Date(Date.parse(arriveAt) - durationSeconds * 1000).toISOString();
  }
  if (arriveAt === undefined && departAt !== undefined) {
    arriveAt = new Date(Date.parse(departAt) + durationSeconds * 1000).toISOString();
  }
  const steps: RouteStepDetail[] = [];
  let stepCursor = departAt === undefined ? undefined : Date.parse(departAt);
  for (const routeLeg of route.legs ?? []) {
    for (const step of routeLeg.steps ?? []) {
      if (step.travelMode !== 'TRANSIT' && step.travelMode !== 'WALK') continue;
      const stepDuration = seconds(step.staticDuration);
      const start = step.startLocation?.latLng;
      const end = step.endLocation?.latLng;
      if (
        stepDuration === undefined || start?.latitude === undefined || start.longitude === undefined ||
        end?.latitude === undefined || end.longitude === undefined
      ) continue;

      const details = step.transitDetails;
      const transitLine: TransitLineDetail | null = step.travelMode === 'TRANSIT' && details !== undefined ? toTransitLine(details) : null;
      const stepDepartAt = isoTimestamp(details?.stopDetails?.departureTime) ??
        (stepCursor === undefined ? '' : new Date(stepCursor).toISOString());
      const stepArriveAt = isoTimestamp(details?.stopDetails?.arrivalTime) ??
        (stepDepartAt === '' ? '' : new Date(Date.parse(stepDepartAt) + stepDuration * 1000).toISOString());
      if (stepArriveAt !== '') stepCursor = Date.parse(stepArriveAt);
      steps.push({
        mode: step.travelMode,
        durationSeconds: stepDuration,
        distanceMeters: Math.round(step.distanceMeters ?? 0),
        polyline: step.polyline?.encodedPolyline ?? '',
        from: {
          label: transitLine?.departureStop ?? '',
          lat: start.latitude,
          lng: start.longitude,
        },
        to: {
          label: transitLine?.arrivalStop ?? '',
          lat: end.latitude,
          lng: end.longitude,
        },
        departAt: stepDepartAt,
        arriveAt: stepArriveAt,
        transitLine,
        navigation: toNavigationSteps(step),
      });
    }
  }
  return {
    durationSeconds,
    distanceMeters: Math.round(route.distanceMeters ?? 0),
    polyline,
    departAt: departAt ?? '',
    arriveAt: arriveAt ?? '',
    transitLines,
    walkSeconds,
    longestWalkSeconds: longestWalkSeconds((route.legs ?? []).flatMap((leg) => leg.steps ?? [])),
    steps,
    navigation: (route.legs ?? []).flatMap((leg) => leg.steps ?? []).flatMap(toNavigationSteps),
  };
}
