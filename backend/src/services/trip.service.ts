import { Error as MongooseError, mongo, type Types } from 'mongoose';
import {
  TripModel,
  type Leg,
  toTripResponse,
  type NewTrip,
  type Trip,
  type TripResponse,
  type TripStatus,
  type TripStatusChange,
} from '../models/trip.model';
import { openFields, sealFields } from './field-crypto';

const DUPLICATE_KEY = 11000; // MongoDB's error code when a unique index refuses a write

// the trip fields queries need readable: owner, status, and the times History sorts and status changes check (#89)
export const READABLE_TRIP_FIELDS: ReadonlySet<string> = new Set([
  '_id', 'userId', 'status', 'tripDate', 'actualStart', 'actualEnd', 'seeded', 'createdAt', 'updatedAt', '__v',
]);

/** A trip as MongoDB stores it, with its fields sealed. */
export type StoredTrip = Record<string, unknown> & { _id: Types.ObjectId };

/**
 * The trips collection without Mongoose's casting, for writing sealed values, which the schema's types would refuse.
 * Reads still go through Mongoose with `lean()`, which returns stored values as they are.
 */
export function storedTrips(): mongo.Collection<StoredTrip> {
  return TripModel.collection as unknown as mongo.Collection<StoredTrip>;
}

const tripContext = (tripId: Types.ObjectId): string => `trips:${tripId.toString()}`;

/** Seals a trip's fields for storage, leaving the readable ones as they are. */
export function sealTripFields(tripId: Types.ObjectId, fields: Record<string, unknown>): Record<string, unknown> {
  return sealFields(fields, tripContext(tripId), READABLE_TRIP_FIELDS);
}

/** Seals a trip for storage. */
export function sealTrip(trip: Trip): StoredTrip {
  return { ...sealTripFields(trip._id, { ...trip }), _id: trip._id };
}

/**
 * Opens a stored trip, sealed or saved before encryption.
 *
 * @remarks
 * Goes through the model, so trips saved before CP2 get the defaults Mongoose fills in, like a COMPLETED status.
 *
 * @param stored - The document as MongoDB returned it (it may be a projection).
 * @returns The plaintext trip.
 * @throws If a sealed field fails to open.
 */
export function openTrip(stored: StoredTrip): Trip {
  return TripModel.hydrate(openFields(stored, tripContext(stored._id))).toObject();
}

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
  const trips = await TripModel.find({ userId }).sort({ tripDate: -1 }).lean<StoredTrip[]>();
  return trips.map((trip) => toTripResponse(openTrip(trip)));
}

/**
 * Saves a planned route as one of a user's trips, for Save for later (PLANNED) or Start (ACTIVE).
 *
 * @remarks
 * `tripDate` is when the trip started, or when it's planned to leave, so History's
 * "newest first" order and period filters keep working. The trip model checks the
 * totals add up before the trip is sealed, and its partial unique index allows one
 * ACTIVE trip per user, even when two Start requests race.
 *
 * @param userId - The user who owns the trip.
 * @param newTrip - The trip, already checked by `parseNewTrip`.
 * @returns `SAVED` with the trip, `INVALID` if its totals don't add up, or
 *   `ALREADY_ACTIVE` if it's ACTIVE and the user already has an ACTIVE trip.
 * @throws If the database operation fails for any other reason.
 */
export async function saveTrip(userId: Types.ObjectId, newTrip: NewTrip): Promise<TripResult> {
  const doc = new TripModel({ ...newTrip, userId, tripDate: newTrip.actualStart ?? newTrip.plannedStart });
  const now = new Date();
  try {
    await doc.validate(); // checks the plaintext, totals included, before it's sealed
    const trip: Trip = { ...doc.toObject(), createdAt: now, updatedAt: now };
    await storedTrips().insertOne(sealTrip(trip));
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
    const trip = await TripModel.findOneAndUpdate(filter, { $set: set }, { returnDocument: 'after' }).lean<StoredTrip>();
    if (trip !== null) return { status: 'SAVED', trip: toTripResponse(openTrip(trip)) };
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

/** A trip's legs for its live update, or why there's no live update. */
export type LiveTripResult =
  | { status: 'ACTIVE'; legs: Leg[] }
  | { status: 'NOT_FOUND' } // no trip with that id belongs to the user
  | { status: 'NOT_ACTIVE' }; // the trip is planned or has ended

/**
 * Loads the legs of one of a user's trips, if it's the active one, for its live update (#87).
 *
 * @param userId - The signed-in user.
 * @param tripId - The trip.
 * @returns `ACTIVE` with the legs, `NOT_FOUND`, or `NOT_ACTIVE`.
 * @throws If the database operation fails.
 */
export async function findLiveTrip(userId: Types.ObjectId, tripId: Types.ObjectId): Promise<LiveTripResult> {
  const stored = await TripModel.findOne({ _id: tripId, userId }, { status: 1, legs: 1 }).lean<StoredTrip>();
  if (stored === null) return { status: 'NOT_FOUND' };
  const trip = openTrip(stored);
  return trip.status === 'ACTIVE' ? { status: 'ACTIVE', legs: trip.legs } : { status: 'NOT_ACTIVE' };
}
