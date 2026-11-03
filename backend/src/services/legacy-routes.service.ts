import { env } from '../config/env';

/** A point on the map, in degrees. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Modes accepted by the legacy chained route endpoint. */
export type TravelMode = 'DRIVE' | 'TRANSIT';

/** One leg returned by the legacy chained route endpoint. */
export interface RouteLeg {
  mode: TravelMode;
  durationSeconds: number;
  distanceMeters: number;
  polyline: string;
}

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';
const TIMEOUT_MS = 10_000;

interface ComputeRoutesResponse {
  routes?: {
    duration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
  }[];
}

function toWaypoint(point: LatLng): object {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

/** Calls Google Routes for one leg of the legacy chained endpoint. */
export async function computeRoute(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode,
): Promise<RouteLeg | null> {
  const response = await fetch(COMPUTE_ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.googleRoutesApiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ origin: toWaypoint(origin), destination: toWaypoint(destination), travelMode: mode }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Routes API responded ${response.status}: ${await response.text()}`);
  }

  const route = ((await response.json()) as ComputeRoutesResponse).routes?.[0];
  const polyline = route?.polyline?.encodedPolyline;
  if (route?.duration === undefined || polyline === undefined) return null;

  return {
    mode,
    durationSeconds: Number.parseInt(route.duration, 10),
    distanceMeters: route.distanceMeters ?? 0,
    polyline,
  };
}