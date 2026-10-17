import { COLOURS, FARE_TYPES, PASS_ZONES, type Profile, type Transit, type Vehicle } from '../models/user.model';
import { isKnownVehicle } from '../services/vehicle.service';

const MAX_TIMEZONE_LENGTH = 64; // the longest IANA names are around 30 characters
const MIN_LITRES_PER_100KM = 1;
const MAX_LITRES_PER_100KM = 40;

/** Narrows an unknown value to a plain object whose fields can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks that a value is one of a fixed list, without trusting its type. */
function isOneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

/** Checks a timezone name, like "America/Vancouver", against the ones Node knows, and returns its standard spelling. */
function parseTimezone(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TIMEZONE_LENGTH) return undefined;
  try {
    // the resolved name fixes capitals and old aliases, e.g. "US/Pacific" becomes "America/Los_Angeles"
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined; // RangeError for a name that isn't a real timezone
  }
}

/** Checks fuel consumption is in range and has at most one decimal, like the app's input allows. */
function isLitresPer100km(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    value >= MIN_LITRES_PER_100KM &&
    value <= MAX_LITRES_PER_100KM &&
    Number(value.toFixed(1)) === value
  );
}

/** Checks the car answers. `null` means the user doesn't drive. */
function parseVehicle(value: unknown): Vehicle | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { make, model, colour, litresPer100km } = value;
  if (typeof make !== 'string' || typeof model !== 'string' || !isKnownVehicle(make, model)) return undefined;
  if (colour !== null && !isOneOf(COLOURS, colour)) return undefined;
  if (!isLitresPer100km(litresPer100km)) return undefined;
  return { make, model, colour, litresPer100km };
}

/** Checks the transit answers. `null` means the user doesn't take transit. */
function parseTransit(value: unknown): Transit | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isOneOf(FARE_TYPES, value.fareType)) return undefined;
  const zones = value.monthlyPassZones ?? null;
  if (value.fareType === 'ADULT_MONTHLY_PASS') {
    return isOneOf(PASS_ZONES, zones) ? { fareType: value.fareType, monthlyPassZones: zones } : undefined;
  }
  return zones === null ? { fareType: value.fareType, monthlyPassZones: null } : undefined;
}

/**
 * Checks every questionnaire answer the app sends.
 *
 * @remarks
 * The app checks the same rules, but the request can't be trusted. Only the
 * known fields are read, so nothing else in the body can reach the database.
 *
 * @param body - The raw request body.
 * @returns The validated profile, or `undefined` if any answer is missing or invalid.
 */
export function parseProfile(body: unknown): Profile | undefined {
  if (!isRecord(body)) return undefined;
  const timezone = parseTimezone(body.timezone);
  const vehicle = parseVehicle(body.vehicle);
  const transit = parseTransit(body.transit);
  if (timezone === undefined || vehicle === undefined || transit === undefined) return undefined;
  return { timezone, vehicle, transit };
}
