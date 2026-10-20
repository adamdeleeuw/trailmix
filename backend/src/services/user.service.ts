import type { Types } from 'mongoose';
import { UserModel, type Profile, type User } from '../models/user.model';
import type { GoogleProfile } from './google.service';

/**
 * Returns the account for a Google account, creating it on first sign-in.
 *
 * @remarks
 * This is one atomic upsert. When two first sign-ins race, the unique index on
 * `googleId` rejects the second insert and MongoDB retries it as an update, so
 * only one account is ever created. The email, name, and photo are refreshed
 * from Google every time.
 *
 * @param profile - The verified Google account.
 * @returns The stored user.
 * @throws If the database operation fails.
 */
export async function upsertGoogleUser(profile: GoogleProfile): Promise<User> {
  const { googleId, ...googleFields } = profile;
  return UserModel.findOneAndUpdate(
    { googleId },
    { $set: googleFields },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
}

/**
 * Looks up a user by ID.
 *
 * @param id - The user's ID.
 * @returns The user, or `null` if the account doesn't exist (e.g. it was deleted).
 * @throws If the database operation fails.
 */
export async function findUserById(id: Types.ObjectId): Promise<User | null> {
  return UserModel.findById(id).lean();
}

/**
 * Saves a user's questionnaire answers and marks their profile as finished.
 *
 * @remarks
 * Replaces the whole profile, so saving `vehicle: null` removes a saved car.
 *
 * @param id - The user's ID.
 * @param profile - Answers already checked by `parseProfile`.
 * @returns The updated user, or `null` if the account doesn't exist.
 * @throws If the database operation fails.
 */
export async function saveUserProfile(id: Types.ObjectId, profile: Profile): Promise<User | null> {
  return UserModel.findByIdAndUpdate(
    id,
    { $set: { ...profile, profileComplete: true } },
    { new: true, runValidators: true },
  ).lean();
}

/**
 * Saves a user's last gas price, stamped with the current time.
 *
 * @param id - The user's ID.
 * @param centsPerLitre - A price already checked by `parseGasPrice`.
 * @returns The updated user, or `null` if the account doesn't exist.
 * @throws If the database operation fails.
 */
export async function saveGasPrice(id: Types.ObjectId, centsPerLitre: number): Promise<User | null> {
  return UserModel.findByIdAndUpdate(
    id,
    { $set: { lastGasPrice: { centsPerLitre, savedAt: new Date() } } },
    { new: true, runValidators: true },
  ).lean();
}

/**
 * Deletes a user's account. Their sessions are deleted separately by `deleteUserSessions`.
 *
 * @param id - The user's ID.
 * @throws If the database operation fails.
 */
export async function deleteUser(id: Types.ObjectId): Promise<void> {
  await UserModel.deleteOne({ _id: id });
}
