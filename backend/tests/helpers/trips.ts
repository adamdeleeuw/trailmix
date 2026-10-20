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
    totalCostCents: DRIVE_CENTS,
    tripDate: new Date('2026-01-01T08:00:00.000Z'),
    ...overrides,
  });
  return doc.toObject();
}
