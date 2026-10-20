import type { Types } from 'mongoose';
import { TripModel, toTripResponse } from '../models/trip.model';

/** Finds a user's trips, newest first, without exposing ownership or seed metadata. */
export async function findTripsByUserId(userId: Types.ObjectId) {
  const trips = await TripModel.find({ userId }).sort({ tripDate: -1 }).exec();
  return trips.map(toTripResponse);
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
