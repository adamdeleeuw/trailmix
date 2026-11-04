import { Error as MongooseError, mongo, type Types } from 'mongoose';
import {
  TripModel,
  toTripResponse,
  type NewTrip,
  type TripResponse,
  type TripStatus,
  type TripStatusChange,
} from '../models/trip.model';

const DUPLICATE_KEY = 11000; // MongoDB's error code when a unique index refuses a write

// the status a trip must have now to move to each status, so a trip only moves forward
const PREVIOUS_STATUS: Record<TripStatusChange['status'], TripStatus> = {
  ACTIVE: 'PLANNED',
  COMPLETED: 'ACTIVE',
  CANCELLED: 'ACTIVE',
};

/** The trip a save or status change wrote, or why it didn't happen. */
export type TripResult =
  | { status: 'SAVED'; trip: TripResponse }
  | { status: 'INVALID' } // the totals don't add up, or the trip would end before it started
  | { status: 'ALREADY_ACTIVE' } // the user already has an ACTIVE trip
  | { status: 'NOT_FOUND' } // no trip with that id belongs to the user
  | { status: 'NOT_ALLOWED' }; // the trip's status can't move to the one asked for

/** What deleting a planned trip did. */
type DeleteTripResult = 'DELETED' | 'NOT_FOUND' | 'NOT_ALLOWED';

/** Whether a write failed because a unique index refused it. */
function isDuplicateKeyError(err: unknown): boolean {
  return err instanceof mongo.MongoServerError && err.code === DUPLICATE_KEY;
}

/**
 * Returns the status of a user's trip, or null if they have no trip with that id.
 *
 * @remarks
 * Only runs after a write matched nothing, to say why. It loads a full document rather
 * than using `lean()`, so a trip saved before CP2 (no stored status) reads as COMPLETED.
 */
async function findTripStatus(userId: Types.ObjectId, tripId: Types.ObjectId): Promise<TripStatus | null> {
  const trip = await TripModel.findOne({ _id: tripId, userId }, { status: 1 });
  return trip === null ? null : trip.status;
}

/** Finds a user's trips, newest first, without exposing ownership or seed metadata. */
export async function findTripsByUserId(userId: Types.ObjectId) {
  const trips = await TripModel.find({ userId }).sort({ tripDate: -1 }).exec();
  return trips.map(toTripResponse);
}

/**
 * Saves a planned route as one of a user's trips, for Save for later (PLANNED) or Start (ACTIVE).
 *
 * @remarks
 * `tripDate` is when the trip started, or when it's planned to leave, so History's
 * "newest first" order and period filters keep working. The trip model checks the
 * totals add up, and its partial unique index allows one ACTIVE trip per user, even
 * when two Start requests race.
 *
 * @param userId - The user who owns the trip.
 * @param newTrip - The trip, already checked by `parseNewTrip`.
 * @returns `SAVED` with the trip, `INVALID` if its totals don't add up, or
 *   `ALREADY_ACTIVE` if it's ACTIVE and the user already has an ACTIVE trip.
 * @throws If the database operation fails for any other reason.
 */
export async function saveTrip(userId: Types.ObjectId, newTrip: NewTrip): Promise<TripResult> {
  try {
    const trip = await TripModel.create({ ...newTrip, userId, tripDate: newTrip.actualStart ?? newTrip.plannedStart });
    return { status: 'SAVED', trip: toTripResponse(trip) };
  } catch (err) {
    if (err instanceof MongooseError.ValidationError) return { status: 'INVALID' };
    if (isDuplicateKeyError(err)) return { status: 'ALREADY_ACTIVE' };
    throw err;
  }
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

/**
 * Starts a planned trip, or ends an active one, at the time the app recorded.
 *
 * @remarks
 * The allowed moves are PLANNED → ACTIVE and ACTIVE → COMPLETED or CANCELLED. The current
 * status and owner are part of the update's filter, so checking and writing are one atomic
 * step: two racing requests can't both win, and another user's trip is never matched.
 * Starting sets `actualStart` and `tripDate`, and ending sets `actualEnd`.
 *
 * @param userId - The signed-in user.
 * @param tripId - The trip to change.
 * @param change - The new status and when it happened, already checked by `parseStatusChange`.
 * @returns `SAVED` with the updated trip, `NOT_FOUND` if the user has no such trip,
 *   `NOT_ALLOWED` if its status can't move to the new one, `INVALID` if it would end before
 *   it started, or `ALREADY_ACTIVE` if starting it would make a second ACTIVE trip.
 * @throws If the database operation fails for any other reason.
 */
export async function updateTripStatus(
  userId: Types.ObjectId,
  tripId: Types.ObjectId,
  change: TripStatusChange,
): Promise<TripResult> {
  const from = PREVIOUS_STATUS[change.status];
  const starting = change.status === 'ACTIVE';

  const set = starting
    ? { status: change.status, actualStart: change.at, tripDate: change.at }
    : { status: change.status, actualEnd: change.at };

  const filter = starting
    ? { _id: tripId, userId, status: from }
    : { _id: tripId, userId, status: from, actualStart: { $lte: change.at } }; // can't end before it started

  try {
    const trip = await TripModel.findOneAndUpdate(filter, { $set: set }, { returnDocument: 'after' });
    if (trip !== null) return { status: 'SAVED', trip: toTripResponse(trip) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { status: 'ALREADY_ACTIVE' };
    throw err;
  }

  const current = await findTripStatus(userId, tripId);
  
  if (current === null) return { status: 'NOT_FOUND' };
  return { status: current === from ? 'INVALID' : 'NOT_ALLOWED' }; // right status, so the end time was the problem
}

/**
 * Deletes one of a user's planned trips, from History's Delete button.
 *
 * @remarks
 * Only PLANNED trips can be deleted, so finished trips stay in History and its totals.
 *
 * @param userId - The signed-in user.
 * @param tripId - The trip to delete.
 * @returns `DELETED`, `NOT_FOUND` if the user has no such trip, or `NOT_ALLOWED` if it isn't PLANNED.
 * @throws If the database operation fails.
 */
export async function deletePlannedTrip(userId: Types.ObjectId, tripId: Types.ObjectId): Promise<DeleteTripResult> {
  const { deletedCount } = await TripModel.deleteOne({ _id: tripId, userId, status: 'PLANNED' });
  if (deletedCount === 1) return 'DELETED';
  return (await findTripStatus(userId, tripId)) === null ? 'NOT_FOUND' : 'NOT_ALLOWED';
}
