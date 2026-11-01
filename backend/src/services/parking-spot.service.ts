import { Types } from 'mongoose';
import {
  MAX_PARKING_SPOTS,
  UserModel,
  type NewParkingSpot,
  type ParkingSpot,
  type ParkingSpotDetails,
} from '../models/user.model';

/** Why saving or editing a parking spot didn't happen, or the spot it saved. */
export type ParkingSpotResult =
  | { status: 'SAVED'; spot: ParkingSpot }
  | { status: 'NO_USER' } // the account was deleted after the session check
  | { status: 'NOT_FOUND' } // no spot with that ID belongs to the user
  | { status: 'LIMIT_REACHED' } // the user already has MAX_PARKING_SPOTS
  | { status: 'DUPLICATE' }; // the user already saved this Google place

/**
 * Returns a user's parking spots, newest first. The Planner calls this to find
 * where a driving trip can switch to transit.
 *
 * @param userId - The user's ID.
 * @returns The user's spots, or an empty list if they have none or the account doesn't exist.
 * @throws If the database operation fails.
 */
export async function getParkingSpots(userId: Types.ObjectId): Promise<ParkingSpot[]> {
  return (await getUserSpotsOrNull(userId)) ?? [];
}

/**
 * Works out why a save didn't match the user, after the fact.
 *
 * @remarks
 * Only runs on the rare failed save, so the common path stays one atomic update.
 */
async function explainRejectedSave(userId: Types.ObjectId): Promise<ParkingSpotResult> {
  const spots = await getUserSpotsOrNull(userId);
  if (spots === null) return { status: 'NO_USER' };
  return spots.length >= MAX_PARKING_SPOTS ? { status: 'LIMIT_REACHED' } : { status: 'DUPLICATE' };
}

/** Returns a user's spots, or `null` if the account doesn't exist. */
async function getUserSpotsOrNull(userId: Types.ObjectId): Promise<ParkingSpot[] | null> {
  // parkingSpots is missing on accounts made before parking spots existed, which counts as none
  const user = await UserModel.findById(userId, { parkingSpots: 1 }).lean<{ parkingSpots?: ParkingSpot[] }>();
  if (user === null) return null;
  return user.parkingSpots ?? [];
}

/**
 * Saves a new parking spot at the front of a user's list.
 *
 * @remarks
 * The limit and the duplicate check are part of the update's filter, so two
 * saves racing can't push a user past 20 spots or save the same place twice.
 * Dropped pins have no place ID, so any number of them can share a street.
 *
 * @param userId - The user's ID.
 * @param newSpot - A spot already checked by `parseNewParkingSpot`.
 * @returns `SAVED` with the stored spot, or why it wasn't saved.
 * @throws If the database operation fails.
 */
export async function saveParkingSpot(userId: Types.ObjectId, newSpot: NewParkingSpot): Promise<ParkingSpotResult> {
  const spot: ParkingSpot = { _id: new Types.ObjectId(), ...newSpot, createdAt: new Date() };
  const filter = {
    _id: userId,
    // accounts made before parking spots existed have no array yet, which counts as empty
    $expr: { $lt: [{ $size: { $ifNull: ['$parkingSpots', []] } }, MAX_PARKING_SPOTS] },
    ...(newSpot.placeId === null ? {} : { 'parkingSpots.placeId': { $ne: newSpot.placeId } }),
  };
  const user = await UserModel.findOneAndUpdate(
    filter,
    { $push: { parkingSpots: { $each: [spot], $position: 0 } } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  return user === null ? explainRejectedSave(userId) : { status: 'SAVED', spot };
}

/**
 * Changes a saved spot's name, cost and overnight rule. Its place and ID stay the same.
 *
 * @param userId - The user's ID.
 * @param spotId - The spot's ID.
 * @param details - New details already checked by `parseParkingSpotDetails`.
 * @returns `SAVED` with the updated spot, `NOT_FOUND` if the user has no such spot, or `NO_USER`.
 * @throws If the database operation fails.
 */
export async function updateParkingSpot(
  userId: Types.ObjectId,
  spotId: Types.ObjectId,
  details: ParkingSpotDetails,
): Promise<ParkingSpotResult> {
  const user = await UserModel.findOneAndUpdate(
    { _id: userId, 'parkingSpots._id': spotId },
    {
      $set: {
        'parkingSpots.$.label': details.label,
        'parkingSpots.$.rateCents': details.rateCents,
        'parkingSpots.$.ratePer': details.ratePer,
        'parkingSpots.$.overnightAllowed': details.overnightAllowed,
      },
    },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (user === null) {
    return (await getUserSpotsOrNull(userId)) === null ? { status: 'NO_USER' } : { status: 'NOT_FOUND' };
  }

  // the filter matched this spot, so it's only missing if another request deleted it in between
  const updated = user.parkingSpots.find((spot) => spot._id.equals(spotId));
  return updated === undefined ? { status: 'NOT_FOUND' } : { status: 'SAVED', spot: updated };
}

/**
 * Deletes one of a user's parking spots.
 *
 * @param userId - The user's ID.
 * @param spotId - The spot's ID.
 * @returns `true` if the spot was deleted, or `false` if the user has no spot with that ID.
 * @throws If the database operation fails.
 */
export async function deleteParkingSpot(userId: Types.ObjectId, spotId: Types.ObjectId): Promise<boolean> {
  const result = await UserModel.updateOne(
    { _id: userId, 'parkingSpots._id': spotId },
    { $pull: { parkingSpots: { _id: spotId } } },
  );
  return result.modifiedCount > 0;
}
