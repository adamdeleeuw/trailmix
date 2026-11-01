import {
  MAX_PARKING_LABEL_LENGTH,
  MIN_PARKING_LABEL_LENGTH,
  RATE_UNITS,
  type LatLng,
  type NewParkingSpot,
  type ParkingRate,
  type ParkingSpotDetails,
} from '../models/user.model';
import { isRecord } from './common.validation';

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;
const MAX_RATE_CENTS = 99999; // $999.99, the most the app's cost input allows
const MAX_PLACE_ID_LENGTH = 512; // Google place IDs are well under this

/** Checks a name and returns it without leading or trailing spaces. */
function parseLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.trim();
  return label.length >= MIN_PARKING_LABEL_LENGTH && label.length <= MAX_PARKING_LABEL_LENGTH ? label : undefined;
}

/** Checks that a value is a finite number from -limit to limit. */
function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** Checks a `{ lat, lng }` point. */
function parseLocation(value: unknown): LatLng | undefined {
  if (!isRecord(value)) return undefined;
  const { lat, lng } = value;
  return isCoordinate(lat, MAX_LATITUDE) && isCoordinate(lng, MAX_LONGITUDE) ? { lat, lng } : undefined;
}

/** Checks a Google place ID. Missing or `null` means the spot is a dropped pin. */
function parsePlaceId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PLACE_ID_LENGTH ? value : undefined;
}

/**
 * Checks a cost and what it's charged per. A missing or `null` cost means it's
 * unknown, and then no unit may be sent either.
 */
function parseRate(rateCents: unknown, ratePer: unknown): ParkingRate | undefined {
  if (rateCents === undefined || rateCents === null) {
    return ratePer === undefined || ratePer === null ? { rateCents: null, ratePer: null } : undefined;
  }
  const validCents = typeof rateCents === 'number' && Number.isInteger(rateCents)
    && rateCents >= 0 && rateCents <= MAX_RATE_CENTS;
  const unit = RATE_UNITS.find((known) => known === ratePer);
  return validCents && unit !== undefined ? { rateCents, ratePer: unit } : undefined;
}

/** Checks the overnight rule. Missing means overnight parking is allowed, like the app's default. */
function parseOvernightAllowed(value: unknown): boolean | undefined {
  if (value === undefined) return true;
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Checks the parts of a parking spot the user can edit.
 *
 * @remarks
 * The body is `{ label, rateCents?, ratePer?, overnightAllowed? }`. Only these
 * fields are read, so nothing else in the body can reach the database.
 *
 * @param body - The raw request body.
 * @returns The validated details, or `undefined` if any field is missing or invalid.
 */
export function parseParkingSpotDetails(body: unknown): ParkingSpotDetails | undefined {
  return isRecord(body) ? detailsFrom(body) : undefined;
}

/** Reads the editable fields from a body already known to be an object. */
function detailsFrom(body: Record<string, unknown>): ParkingSpotDetails | undefined {
  const label = parseLabel(body.label);
  const rate = parseRate(body.rateCents, body.ratePer);
  const overnightAllowed = parseOvernightAllowed(body.overnightAllowed);
  if (label === undefined || rate === undefined || overnightAllowed === undefined) return undefined;
  return { label, ...rate, overnightAllowed };
}

/**
 * Checks a new parking spot the app sends.
 *
 * @remarks
 * The body is `{ label, location, placeId?, rateCents?, ratePer?, overnightAllowed? }`:
 * - `label`: 1 to 60 characters after trimming spaces.
 * - `location`: `{ lat, lng }`, with lat from -90 to 90 and lng from -180 to 180.
 * - `placeId`: a Google place ID, or missing or `null` for a dropped pin.
 * - `rateCents`: whole cents from 0 to 99999, or missing or `null` when the cost is unknown.
 * - `ratePer`: `"HOUR"` or `"DAY"` when `rateCents` is set, otherwise missing or `null`.
 * - `overnightAllowed`: a boolean, `true` when missing.
 *
 * @param body - The raw request body.
 * @returns The validated spot, or `undefined` if any field is missing or invalid.
 */
export function parseNewParkingSpot(body: unknown): NewParkingSpot | undefined {
  if (!isRecord(body)) return undefined;
  const details = detailsFrom(body);
  const location = parseLocation(body.location);
  const placeId = parsePlaceId(body.placeId);
  if (details === undefined || location === undefined || placeId === undefined) return undefined;
  return { ...details, location, placeId };
}
