import type { Types } from 'mongoose';
import { TripModel, toTripResponse } from '../models/trip.model';

/** Finds a user's trips, newest first, without exposing ownership or seed metadata. */
export async function findTripsByUserId(userId: Types.ObjectId) {
  const trips = await TripModel.find({ userId }).sort({ tripDate: -1 }).exec();
  return trips.map(toTripResponse);
}