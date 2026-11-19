import { mongo, Types } from 'mongoose';
import {
  DEFAULT_COST_VS_TIME,
  DEFAULT_MAX_WALK_MINUTES,
  DEFAULT_PLANNING_MODES,
  UserModel,
  type ParkingSpot,
  type PlanningPreferences,
  type Profile,
  type User,
} from '../models/user.model';
import { lookupHash, openFields, sealFields } from './field-crypto';
import type { GoogleProfile } from './google.service';

const DUPLICATE_KEY = 11000; // MongoDB's error code when a unique index refuses a write

// the user fields queries and the app's routing need readable; everything else is sealed (#89)
export const READABLE_USER_FIELDS: ReadonlySet<string> = new Set([
  '_id', 'googleId', 'profileComplete', 'parkingSpots', 'createdAt', 'updatedAt', '__v',
]);
// a parking spot's id and time are readable, and its place ID only as a lookup hash for the duplicate check
export const READABLE_SPOT_FIELDS: ReadonlySet<string> = new Set(['_id', 'createdAt', 'placeIdHash']);

// what a new account starts with, as setDefaultsOnInsert gave it before encryption
const NEW_USER_FIELDS = {
  profileComplete: false,
  timezone: null,
  vehicle: null,
  transit: null,
  lastGasPrice: null,
  parkingSpots: [],
  costVsTime: DEFAULT_COST_VS_TIME,
  defaultModes: [...DEFAULT_PLANNING_MODES],
  maxWalkMinutes: DEFAULT_MAX_WALK_MINUTES,
};

/** A stored parking spot, with its fields sealed. */
export type StoredSpot = Record<string, unknown> & { _id: Types.ObjectId };

/** A user as MongoDB stores it. Only the readable fields are typed, the sealed ones are opened by {@link openUser}. */
export interface StoredUser {
  _id: Types.ObjectId;
  googleId?: string;
  parkingSpots?: StoredSpot[];
}

/**
 * The users collection without Mongoose's casting, for writing sealed values, which the schema's types would refuse.
 * Reads still go through Mongoose with `lean()`, which returns stored values as they are.
 */
export function storedUsers(): mongo.Collection<StoredUser> {
  return UserModel.collection as unknown as mongo.Collection<StoredUser>;
}

const userContext = (userId: Types.ObjectId): string => `users:${userId.toString()}`;

/** The context a parking spot's fields are sealed with. */
export const spotContext = (userId: Types.ObjectId, spotId: Types.ObjectId): string =>
  `${userContext(userId)}:parkingSpots:${spotId.toString()}`;

/** Seals a user's fields for storage, leaving the readable ones as they are. */
export function sealUserFields(userId: Types.ObjectId, fields: Record<string, unknown>): Record<string, unknown> {
  return sealFields(fields, userContext(userId), READABLE_USER_FIELDS);
}

/**
 * Seals a parking spot for storage.
 *
 * @param userId - The spot's owner.
 * @param spot - The plaintext spot.
 * @returns The stored spot, with its place ID's lookup hash beside the sealed fields.
 */
export function sealSpot(userId: Types.ObjectId, spot: ParkingSpot): StoredSpot {
  const placeIdHash = spot.placeId === null ? null : lookupHash(spot.placeId);
  return { ...sealFields({ ...spot }, spotContext(userId, spot._id), READABLE_SPOT_FIELDS), _id: spot._id, placeIdHash };
}

/** Opens a stored parking spot. */
export function openSpot(userId: Types.ObjectId, stored: StoredSpot): ParkingSpot {
  const spot = openFields(stored, spotContext(userId, stored._id));
  delete spot.placeIdHash; // only for the duplicate check, never part of a spot
  return spot as unknown as ParkingSpot;
}

/**
 * Opens a stored user, sealed or saved before encryption.
 *
 * @param stored - The document as MongoDB returned it (it may be a projection).
 * @returns The plaintext user.
 * @throws If a sealed field fails to open.
 */
export function openUser(stored: StoredUser): User {
  const user = openFields({ ...stored }, userContext(stored._id));
  if (stored.parkingSpots !== undefined) user.parkingSpots = stored.parkingSpots.map((spot) => openSpot(stored._id, spot));
  return user as unknown as User;
}

// sets fields on a user, sealed, and returns the opened result; one atomic write, as before encryption
async function updateUser(userId: Types.ObjectId, fields: Record<string, unknown>): Promise<User | null> {
  await UserModel.validate(fields, Object.keys(fields)); // the schema still checks the plaintext
  const stored = await storedUsers().findOneAndUpdate(
    { _id: userId },
    { $set: { ...sealUserFields(userId, fields), updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return stored === null ? null : openUser(stored);
}

/**
 * Returns the account for a Google account, creating it on first sign-in.
 *
 * @remarks
 * The account is found by the keyed hash of Google's ID, whose unique index refuses a second account for the same
 * Google account. When two first sign-ins race, the loser's insert is refused, and its retry finds the account the
 * winner created, so only one account is ever made. The email, name, and photo are refreshed from Google every time.
 *
 * @param profile - The verified Google account.
 * @returns The stored user.
 * @throws If the database operation fails.
 */
export async function upsertGoogleUser(profile: GoogleProfile): Promise<User> {
  const { googleId: googleSub, ...googleFields } = profile;
  const googleId = lookupHash(googleSub);
  // an account saved before encryption still holds the plain ID until the migration runs, so it's switched now
  await UserModel.updateOne({ googleId: googleSub }, { $set: { googleId } });
  try {
    return await upsertByGoogleId(googleId, googleFields);
  } catch (err) {
    if (!(err instanceof mongo.MongoServerError) || err.code !== DUPLICATE_KEY) throw err;
    return upsertByGoogleId(googleId, googleFields); // another first sign-in created the account, so this updates it
  }
}

// updates the account with this hashed Google ID, or creates it with an ID chosen here, since sealing needs the ID
async function upsertByGoogleId(googleId: string, googleFields: Omit<GoogleProfile, 'googleId'>): Promise<User> {
  const existing = await UserModel.findOne({ googleId }, { _id: 1 }).lean();
  const userId = existing?._id ?? new Types.ObjectId();
  const now = new Date();
  const stored = await storedUsers().findOneAndUpdate(
    { _id: userId, googleId },
    {
      $set: { ...sealUserFields(userId, googleFields), updatedAt: now },
      $setOnInsert: { ...sealUserFields(userId, NEW_USER_FIELDS), createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (stored === null) throw new Error('The upsert returned no user'); // an upsert always returns one
  return openUser(stored);
}

/**
 * Looks up a user by ID.
 *
 * @param id - The user's ID.
 * @returns The user, or `null` if the account doesn't exist (e.g. it was deleted).
 * @throws If the database operation fails.
 */
export async function findUserById(id: Types.ObjectId): Promise<User | null> {
  const stored = await UserModel.findById(id).lean<StoredUser>();
  return stored === null ? null : openUser(stored);
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
  return updateUser(id, { timezone: profile.timezone, vehicle: profile.vehicle, transit: profile.transit, profileComplete: true });
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
  return updateUser(id, { lastGasPrice: { centsPerLitre, savedAt: new Date() } });
}

/** Saves the user's default route-planning preferences. */
export async function savePlanningPreferences(
  id: Types.ObjectId,
  preferences: PlanningPreferences,
): Promise<User | null> {
  const { costVsTime, defaultModes, maxWalkMinutes } = preferences;
  return updateUser(id, { costVsTime, defaultModes, ...(maxWalkMinutes === undefined ? {} : { maxWalkMinutes }) });
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
