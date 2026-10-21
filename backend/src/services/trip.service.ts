import type { Types } from 'mongoose';
import { DEMO_TRIPS } from '../data/demo-trips';
import { TripModel, toTripResponse } from '../models/trip.model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEMO_HOUR_UTC = 15; // 08:15 in Vancouver during daylight time, a morning commute
const DEMO_MINUTE = 15;

/** Finds a user's trips, newest first, without exposing ownership or seed metadata. */
export async function findTripsByUserId(userId: Types.ObjectId) {
  const trips = await TripModel.find({ userId }).sort({ tripDate: -1 }).exec();
  return trips.map(toTripResponse);
}

/**
 * Replaces a user's demo trips with a fresh set dated in the days before `now`.
 *
 * @remarks
 * Only trips marked `seeded` are removed, so running it again never duplicates the
 * demo trips or touches trips the user saved.
 *
 * @param userId - The user who gets the demo trips.
 * @param now - When the trips are seeded, which they are dated back from.
 * @throws If the database operation fails.
 */
export async function seedDemoTrips(userId: Types.ObjectId, now: Date = new Date()): Promise<void> {
  const trips = DEMO_TRIPS.map(({ daysAgo, legs, ...places }) => {
    const tripDate = new Date(now.getTime() - daysAgo * MS_PER_DAY);
    tripDate.setUTCHours(DEMO_HOUR_UTC, DEMO_MINUTE, 0, 0);
    return {
      userId,
      ...places,
      legs,
      totalDurationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
      totalCostCents: legs.reduce((sum, leg) => sum + leg.costCents, 0),
      tripDate,
      seeded: true,
    };
  });

  await TripModel.deleteMany({ userId, seeded: true });
  await TripModel.insertMany(trips);
}

/**
 * Deletes every trip a user has saved, when their account is deleted.
 *
 * @param userId - The user whose trips are deleted.
 * @throws If the database operation fails.
 */
export async function deleteUserTrips(userId: Types.ObjectId): Promise<void> {
  await TripModel.deleteMany({ userId });
}
