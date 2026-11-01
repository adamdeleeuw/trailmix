import { Types } from 'mongoose';
import { UserModel, type ParkingSpot } from '../../src/models/user.model';

/** UBC North Parkade, a real spot a user would save from search. */
const NORTH_PARKADE = {
  label: 'UBC North Parkade',
  location: { lat: 49.2697, lng: -123.2513 },
  placeId: 'ChIJ-north-parkade',
  rateCents: 300,
  ratePer: 'HOUR',
  overnightAllowed: false,
};

/**
 * Builds a valid `POST /api/users/me/parking-spots` body.
 *
 * @param overrides - Fields to set instead of the defaults, or `undefined` to leave a field out.
 * @returns A body for UBC North Parkade at $3/hour with no overnight parking, plus the overrides.
 */
export function parkingSpotBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...NORTH_PARKADE, ...overrides };
}

/**
 * Adds parking spots straight to a user in the test database, newest first,
 * so tests can fill a user up to the limit without many requests.
 *
 * @param userId - The user who owns the spots.
 * @param count - How many dropped-pin spots to add.
 * @returns The stored spots, newest first.
 */
export async function addParkingSpots(userId: Types.ObjectId, count: number): Promise<ParkingSpot[]> {
  const spots: ParkingSpot[] = Array.from({ length: count }, (_, index) => ({
    _id: new Types.ObjectId(),
    label: `Side street ${index + 1}`,
    location: { lat: 49.25 + index / 1000, lng: -123.1 },
    placeId: null,
    rateCents: null,
    ratePer: null,
    overnightAllowed: true,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
  }));
  const newestFirst = spots.reverse();
  await UserModel.updateOne({ _id: userId }, { $push: { parkingSpots: { $each: newestFirst, $position: 0 } } });
  return newestFirst;
}
