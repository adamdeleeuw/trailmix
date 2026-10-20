import { env } from '../config/env';

/** A point on the map, in degrees. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** The Routes API travel modes Trailmix uses. */
export type TravelMode = 'DRIVE' | 'TRANSIT';

/** One leg of a commute, as the app needs it to draw and label the route. */
export interface RouteLeg {
  mode: TravelMode;
  durationSeconds: number;
  distanceMeters: number;
  polyline: string; // Google's encoded polyline format
}

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
// only ask for the fields we use: Google bills by which fields you request
const FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';
const TIMEOUT_MS = 10_000;

/** The parts of a computeRoutes response we read. Every field can be missing. */
interface ComputeRoutesResponse {
  routes?: {
    duration?: string; // e.g. "1234s"
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
  }[];
}

function toWaypoint(point: LatLng): object {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

/**
 * Asks Google's Routes API for the best route between two points.
 *
 * @returns The route, or `null` if Google found none (e.g. no transit runs there).
 * @throws If the request fails or Google responds with an error.
 */
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
    // no routingPreference: driving defaults to ignoring live traffic (the cheaper tier),
    // and transit requests reject the field entirely
    body: JSON.stringify({ origin: toWaypoint(origin), destination: toWaypoint(destination), travelMode: mode }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Routes API responded ${response.status}: ${await response.text()}`);
  }

  const route = ((await response.json()) as ComputeRoutesResponse).routes?.[0];
  const polyline = route?.polyline?.encodedPolyline;
  if (route?.duration === undefined || polyline === undefined) {
    return null; // Google answers {} when there is no route
  }

  return {
    mode,
    durationSeconds: Number.parseInt(route.duration, 10),
    distanceMeters: route.distanceMeters ?? 0,
    polyline,
  };
}