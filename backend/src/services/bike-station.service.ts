import stationSeed from '../data/translink-stations.json';
import { env } from '../config/env';
import type { PlannerPlace } from './planner.core';
import { distanceMeters } from './planner.core';

export type BikeLegEndpoint = 'ORIGIN' | 'DESTINATION';
export type BikeStationSource = 'GTFS' | 'GOOGLE_PLACES';

export interface BikeStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  source: BikeStationSource;
}

export interface BikeStationCandidate extends BikeStation {
  cyclingDistanceMeters: number;
  routeDeviationMeters: number;
}

export interface BikeStationSearch {
  origin: PlannerPlace;
  destination: PlannerPlace;
  bikeLegEndpoint: BikeLegEndpoint;
  maxCyclingDistanceMeters?: number;
  candidateCount?: number;
}

interface GooglePlace {
  id?: unknown;
  displayName?: { text?: unknown };
  location?: { latitude?: unknown; longitude?: unknown };
  types?: unknown;
}

interface CachedPlaces {
  expiresAt: number;
  result: Promise<BikeStation[]>;
}

const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const GOOGLE_PLACES_TIMEOUT_MS = 10_000;
const GOOGLE_PLACES_CACHE_TTL_MS = 5 * 60_000;
const GOOGLE_PLACES_CACHE_MAX_ENTRIES = 100;
const GOOGLE_PLACES_MAX_RADIUS_METERS = 50_000;
const STATION_DEDUPE_METERS = 75;
const JOURNEY_EARTH_RADIUS_METERS = 6_371_000;
const ACCEPTED_PLACE_TYPES = new Set(['subway_station', 'train_station', 'light_rail_station', 'transit_station']);
const RAIL_PLACE_TYPES = new Set(['subway_station', 'train_station', 'light_rail_station']);

const placesCache = new Map<string, CachedPlaces>();

const SEEDED_STATIONS: BikeStation[] = stationSeed.stations.map((station) => ({
  id: station.id,
  name: station.name,
  lat: station.lat,
  lng: station.lng,
  source: 'GTFS',
}));

function routePosition(station: BikeStation, origin: PlannerPlace, destination: PlannerPlace): { progress: number; deviation: number } {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const scaleX = JOURNEY_EARTH_RADIUS_METERS * Math.cos(radians(origin.lat));
  const scaleY = JOURNEY_EARTH_RADIUS_METERS;
  const stationX = radians(station.lng - origin.lng) * scaleX;
  const stationY = radians(station.lat - origin.lat) * scaleY;
  const destinationX = radians(destination.lng - origin.lng) * scaleX;
  const destinationY = radians(destination.lat - origin.lat) * scaleY;
  const journeyLengthSquared = destinationX ** 2 + destinationY ** 2;
  const progress = journeyLengthSquared === 0
    ? 0
    : (stationX * destinationX + stationY * destinationY) / journeyLengthSquared;
  return {
    progress,
    deviation: Math.hypot(stationX - progress * destinationX, stationY - progress * destinationY),
  };
}

function validateSearch(search: BikeStationSearch, maxDistance: number, candidateCount: number): void {
  if (!Number.isSafeInteger(maxDistance) || maxDistance < 1) {
    throw new RangeError('maxCyclingDistanceMeters must be a positive integer');
  }
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 1) {
    throw new RangeError('candidateCount must be a positive integer');
  }
  for (const point of [search.origin, search.destination]) {
    if (
      !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 ||
      !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180
    ) throw new RangeError('journey coordinates must be valid latitude and longitude values');
  }
}

/** Filters and ranks stations using endpoint cycling distance and their position on the journey corridor. */
export function rankBikeStationCandidates(
  search: Pick<BikeStationSearch, 'origin' | 'destination' | 'bikeLegEndpoint'>,
  stations: readonly BikeStation[],
  maxCyclingDistanceMeters: number,
  candidateCount: number,
): BikeStationCandidate[] {
  const endpoint = search.bikeLegEndpoint === 'ORIGIN' ? search.origin : search.destination;
  const journeyDistance = distanceMeters(search.origin, search.destination);
  return stations.flatMap((station) => {
    if (
      typeof station.id !== 'string' || station.id.length === 0 ||
      typeof station.name !== 'string' || station.name.trim().length === 0 ||
      !Number.isFinite(station.lat) || station.lat < -90 || station.lat > 90 ||
      !Number.isFinite(station.lng) || station.lng < -180 || station.lng > 180
    ) return [];
    const cyclingDistanceMeters = distanceMeters(endpoint, station);
    if (cyclingDistanceMeters > maxCyclingDistanceMeters) return [];
    const route = routePosition(station, search.origin, search.destination);
    if (route.progress < 0 || route.progress > 1) return [];
    const routeDeviationMeters = route.deviation;
    const journeyDetourMeters = Math.max(
      0,
      distanceMeters(search.origin, station) + distanceMeters(station, search.destination) - journeyDistance,
    );
    if (journeyDetourMeters > maxCyclingDistanceMeters) return [];
    return [{ ...station, cyclingDistanceMeters, routeDeviationMeters }];
  })
    .sort((a, b) =>
      a.cyclingDistanceMeters + a.routeDeviationMeters - b.cyclingDistanceMeters - b.routeDeviationMeters ||
      (a.source === b.source ? 0 : a.source === 'GTFS' ? -1 : 1) ||
      a.id.localeCompare(b.id),
    )
    .filter((station, index, ranked) =>
      ranked.findIndex((other) =>
        other.id === station.id ||
        distanceMeters(other, station) < STATION_DEDUPE_METERS,
      ) === index,
    )
    .slice(0, candidateCount);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toGoogleStation(value: unknown): BikeStation | null {
  if (!isRecord(value)) return null;
  const place = value as GooglePlace;
  const name = place.displayName?.text;
  const location = place.location;
  const types = place.types;
  if (
    typeof place.id !== 'string' || place.id.length === 0 ||
    typeof name !== 'string' || name.trim().length === 0 ||
    typeof location?.latitude !== 'number' || !Number.isFinite(location.latitude) ||
    typeof location.longitude !== 'number' || !Number.isFinite(location.longitude) ||
    location.latitude < -90 || location.latitude > 90 ||
    location.longitude < -180 || location.longitude > 180 ||
    !Array.isArray(types) || !types.every((type) => typeof type === 'string')
  ) return null;
  const hasRailType = types.some((type) => RAIL_PLACE_TYPES.has(type));
  if (!hasRailType && !types.some((type) => type === 'transit_station')) return null;
  if (!types.some((type) => ACCEPTED_PLACE_TYPES.has(type))) return null;
  return {
    id: place.id,
    name: name.trim(),
    lat: location.latitude,
    lng: location.longitude,
    source: 'GOOGLE_PLACES',
  };
}

function placesCacheKey(center: PlannerPlace, radiusMeters: number): string {
  return `${center.lat.toFixed(4)}:${center.lng.toFixed(4)}:${radiusMeters}`;
}

async function fetchNearbyStations(center: PlannerPlace, radiusMeters: number): Promise<BikeStation[]> {
  const apiKey = env.googlePlacesApiKey;
  if (apiKey === undefined) throw new Error('GOOGLE_PLACES_API_KEY is not configured');

  const response = await fetch(GOOGLE_PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.types',
    },
    body: JSON.stringify({
      includedTypes: ['transit_station', 'subway_station', 'train_station', 'light_rail_station'],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: radiusMeters,
        },
      },
    }),
    signal: AbortSignal.timeout(GOOGLE_PLACES_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Places API responded ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.places)) return [];
  return body.places.flatMap((place) => {
    const station = toGoogleStation(place);
    return station === null ? [] : [station];
  });
}

function cachedNearbyStations(center: PlannerPlace, radiusMeters: number): Promise<BikeStation[]> {
  const key = placesCacheKey(center, radiusMeters);
  const cached = placesCache.get(key);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.result;

  const result = fetchNearbyStations(center, radiusMeters);
  placesCache.set(key, { expiresAt: Date.now() + GOOGLE_PLACES_CACHE_TTL_MS, result });
  if (placesCache.size > GOOGLE_PLACES_CACHE_MAX_ENTRIES) {
    const oldestKey = placesCache.keys().next().value;
    if (oldestKey !== undefined) placesCache.delete(oldestKey);
  }
  void result.catch(() => {
    if (placesCache.get(key)?.result === result) placesCache.delete(key);
  });
  return result;
}

/**
 * Finds nearby frequent-service stations for the cycling end of a bike-transit journey.
 * The seeded TransLink stations are preferred; Places is queried only when that list
 * cannot fill the requested candidate count.
 */
export async function findBikeStationCandidates(search: BikeStationSearch): Promise<BikeStationCandidate[]> {
  const maxDistance = search.maxCyclingDistanceMeters ?? env.maxBicycleLegDistanceMeters;
  const candidateCount = search.candidateCount ?? env.bikeStationCandidateCount;
  validateSearch(search, maxDistance, candidateCount);
  const seeded = rankBikeStationCandidates(search, SEEDED_STATIONS, maxDistance, candidateCount);
  if (seeded.length >= candidateCount) return seeded;

  const center = search.bikeLegEndpoint === 'ORIGIN' ? search.origin : search.destination;
  const radiusMeters = Math.min(maxDistance, GOOGLE_PLACES_MAX_RADIUS_METERS);
  try {
    const additional = await cachedNearbyStations(center, radiusMeters);
    return rankBikeStationCandidates(search, [...seeded, ...additional], maxDistance, candidateCount);
  } catch (error) {
    console.warn('Bike station Places fallback failed; returning seeded stations only.', error);
    return seeded;
  }
}

/** Exported for tests and diagnostics; the records originate in the generated GTFS seed. */
export const SEEDED_BIKE_STATIONS: readonly BikeStation[] = SEEDED_STATIONS;
