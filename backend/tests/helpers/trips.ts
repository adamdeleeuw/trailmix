import type { Types } from 'mongoose';
import { TripModel, type Place, type Trip } from '../../src/models/trip.model';

const HOME: Place = { label: 'Home', lat: 49.2, lng: -123.1, placeId: null };
const WORK: Place = { label: 'Work', lat: 49.28, lng: -123.12, placeId: null };
const DRIVE_SECONDS = 600;
const DRIVE_METRES = 5000;
const DRIVE_CENTS = 125;

/**
 * Adds a one-leg driving trip straight to the test database.
 *
 * @param userId - The user who owns the trip.
 * @param overrides - Fields to set on the trip instead of the defaults.
 * @returns The stored trip.
 */
export async function createTrip(
  userId: Types.ObjectId,
  overrides: Partial<Omit<Trip, '_id' | 'userId'>> = {},
): Promise<Trip> {
  const origin = overrides.origin ?? HOME;
  const doc = await TripModel.create({
    userId,
    origin,
    midpoint: null,
    destination: WORK,
    legs: [{
      mode: 'DRIVE',
      from: origin,
      to: WORK,
      durationSeconds: DRIVE_SECONDS,
      distanceMeters: DRIVE_METRES,
      costCents: DRIVE_CENTS,
      polyline: 'encoded-route',
      transitLines: [],
    }],
    totalDurationSeconds: DRIVE_SECONDS,
    totalDistanceMeters: DRIVE_METRES,
    totalCostCents: DRIVE_CENTS,
    costBreakdown: { fuelCents: DRIVE_CENTS, parkingCents: 0, fareCents: 0 },
    tripDate: new Date('2026-01-01T08:00:00.000Z'),
    ...overrides,
  });
  return doc.toObject();
}

/** Where `ROUTE_OPTION` starts. */
export const BURNABY_HOME = { label: 'Home', lat: 49.2488, lng: -122.9805, placeId: null };
const PRODUCTION_WAY_LOT = { label: 'Production Way lot', lat: 49.2534, lng: -122.9183, placeId: 'ChIJ-production-way' };
const PRODUCTION_WAY_STATION = { label: 'Production Way–University Station', lat: 49.2535, lng: -122.9181, placeId: null };
const WATERFRONT = { label: 'Waterfront Station', lat: 49.2859, lng: -123.1117, placeId: null };
/** Where `ROUTE_OPTION` ends. */
export const DOWNTOWN = { label: 'Downtown office', lat: 49.2849, lng: -123.1153, placeId: 'ChIJ-downtown' };

/** A turn-by-turn instruction on `DRIVE_LEG`, for tests that change one step. */
export const TURN = { instruction: 'Turn left onto Production Way', maneuver: 'TURN_LEFT', lat: 49.2521, lng: -122.9199 };

/** `ROUTE_OPTION`'s first leg, for tests that change one leg. Its cost is fuel plus parking. */
export const DRIVE_LEG = {
  mode: 'DRIVE', from: BURNABY_HOME, to: PRODUCTION_WAY_LOT,
  departAt: '2026-11-03T15:30:00.000Z', arriveAt: '2026-11-03T15:44:00.000Z',
  durationSeconds: 840, distanceMeters: 9000, costCents: 420, polyline: 'drive-polyline', transitLines: [],
  steps: [{ instruction: 'Head east on Lougheed Hwy', maneuver: 'DEPART', lat: 49.2488, lng: -122.9805 }, TURN],
};

/** `ROUTE_OPTION`'s SkyTrain leg, for tests that change its transit line. */
export const TRANSIT_LEG = {
  mode: 'TRANSIT', from: PRODUCTION_WAY_STATION, to: WATERFRONT,
  departAt: '2026-11-03T15:50:00.000Z', arriveAt: '2026-11-03T16:15:00.000Z',
  durationSeconds: 1500, distanceMeters: 14000, costCents: 335, polyline: 'transit-polyline',
  transitLines: [{
    name: 'Expo Line', shortName: null, vehicle: 'SkyTrain', colour: '#0060A9', headsign: 'Waterfront',
    departureStop: 'Production Way–University', arrivalStop: 'Waterfront', stopCount: 12,
  }],
  steps: [],
};

/**
 * A Planner `RouteOption` (see issue #70): drive to a parking lot, walk to SkyTrain, ride, then walk.
 * Its totals add up to its legs, and fuel (120) + parking (300) + fare (335) = 755 cents.
 * Times end in `.000Z`, so they read back exactly as sent.
 */
export const ROUTE_OPTION = {
  label: 'CHEAPEST', // label, lateByMinutes and transfers are sent by the app, but a trip doesn't store them
  lateByMinutes: 0,
  transfers: 1,
  leaveAt: '2026-11-03T15:30:00.000Z',
  arriveAt: '2026-11-03T16:20:00.000Z',
  totalDurationSeconds: 2820,
  totalDistanceMeters: 23650,
  totalCostCents: 755,
  costBreakdown: { fuelCents: 120, parkingCents: 300, fareCents: 335 },
  costEstimated: false,
  baselineDriveCostCents: 900,
  transferPoints: [PRODUCTION_WAY_LOT],
  legs: [
    DRIVE_LEG,
    {
      mode: 'WALK', from: PRODUCTION_WAY_LOT, to: PRODUCTION_WAY_STATION,
      departAt: '2026-11-03T15:44:00.000Z', arriveAt: '2026-11-03T15:47:00.000Z',
      durationSeconds: 180, distanceMeters: 250, costCents: 0, polyline: 'walk-polyline', transitLines: [],
      steps: [{ instruction: 'Walk to Production Way–University Station', maneuver: 'STRAIGHT', lat: 49.2534, lng: -122.9183 }],
    },
    TRANSIT_LEG,
    {
      mode: 'WALK', from: WATERFRONT, to: DOWNTOWN,
      departAt: '2026-11-03T16:15:00.000Z', arriveAt: '2026-11-03T16:20:00.000Z',
      durationSeconds: 300, distanceMeters: 400, costCents: 0, polyline: 'walk-polyline-2', transitLines: [],
      steps: [],
    },
  ],
};

/**
 * Builds a valid `POST /api/users/me/trips` body.
 *
 * @param overrides - Fields to set instead of the defaults, e.g. `{ status: 'ACTIVE' }`
 *   or `{ option: { ...ROUTE_OPTION, legs: [] } }`.
 * @returns A body saving `ROUTE_OPTION` for later, arriving by 16:30, plus the overrides.
 */
export function tripBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { option: ROUTE_OPTION, status: 'PLANNED', arriveBy: '2026-11-03T16:30:00.000Z', ...overrides };
}
