import { env } from '../config/env';
import type { NavigationStep } from '../models/trip.model';
import type { PlannerPlace } from './planner.core';

export type PlannerMode = 'DRIVE' | 'TRANSIT';

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

async function postGoogle<T>(url: string, fieldMask: string, body: object): Promise<T> {
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
      if (!response.ok) throw new Error(`Routes API responded ${response.status}`);
      return (await response.json()) as T;
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
            departureStop?: { name?: string };
            arrivalStop?: { name?: string };
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
  };
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

/** Retrieves full route geometry and transit labels for one planned leg. */
export async function computeRouteDetails(
  origin: PlannerPlace,
  destination: PlannerPlace,
  mode: PlannerMode,
  time: { departureTime?: string; arrivalTime?: string },
): Promise<RouteDetail | null> {
  const response = await postGoogle<GoogleDetailsResponse>(DETAILS_URL, DETAILS_FIELD_MASK, {
    origin: waypoint(origin),
    destination: waypoint(destination),
    travelMode: mode,
    ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    ...time,
  });
  const route = response.routes?.[0];
  const durationSeconds = seconds(route?.duration);
  const polyline = route?.polyline?.encodedPolyline;
  if (route === undefined || durationSeconds === undefined || polyline === undefined) return null;

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