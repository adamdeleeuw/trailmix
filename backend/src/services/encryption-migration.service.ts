/**
 * Seals the users and trips saved before encryption (#89), once, from `scripts/encrypt-existing.ts`.
 *
 * @remarks
 * The services already read both forms, so the app keeps working while this runs, and a second run changes nothing.
 */
import { isSealed, lookupHash } from './field-crypto';
import { openTrip, READABLE_TRIP_FIELDS, sealTripFields, storedTrips, type StoredTrip } from './trip.service';
import {
  openSpot,
  openUser,
  READABLE_SPOT_FIELDS,
  READABLE_USER_FIELDS,
  sealSpot,
  sealUserFields,
  storedUsers,
  type StoredSpot,
  type StoredUser,
} from './user.service';

const LOOKUP_HASH = /^[0-9a-f]{64}$/; // a keyed hash; Google's account IDs are digits

/** How many documents held plaintext, and what happened to them. */
export interface MigrationReport {
  users: number; // users with a plaintext field or Google ID
  trips: number; // trips with a plaintext field
  sealed: number; // documents written, 0 on a dry run
  changedDuringRun: number; // edited by a request between reading and writing, so left for the next run
}

// the fields of a stored document that are neither readable by design nor sealed
function plaintextFields(stored: object, readable: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(stored).filter(([name, value]) => !readable.has(name) && !isSealed(value)));
}

const isPlaintextSpot = (spot: StoredSpot): boolean =>
  Object.keys(plaintextFields(spot, READABLE_SPOT_FIELDS)).length > 0 || !('placeIdHash' in spot);

// the $set that seals a user's plaintext, or null when there's none
function userChanges(stored: StoredUser): Record<string, unknown> | null {
  const changes = sealUserFields(stored._id, plaintextFields(stored, READABLE_USER_FIELDS));
  if (stored.googleId !== undefined && !LOOKUP_HASH.test(stored.googleId)) changes.googleId = lookupHash(stored.googleId);
  const spots = stored.parkingSpots ?? [];
  if (spots.some(isPlaintextSpot)) changes.parkingSpots = spots.map((spot) => sealSpot(stored._id, openSpot(stored._id, spot)));
  return Object.keys(changes).length === 0 ? null : changes;
}

// the $set that seals a trip's plaintext, or null when there's none
function tripChanges(stored: StoredTrip): Record<string, unknown> | null {
  const changes = sealTripFields(stored._id, plaintextFields(stored, READABLE_TRIP_FIELDS));
  return Object.keys(changes).length === 0 ? null : changes;
}

// matches the document only as it was read, so a request's edit in between isn't overwritten
const unchangedSince = (stored: { _id: unknown; updatedAt?: unknown }): Record<string, unknown> =>
  stored.updatedAt === undefined ? { _id: stored._id } : { _id: stored._id, updatedAt: stored.updatedAt };

/**
 * Finds every user and trip with plaintext fields, and seals them when `apply` is set.
 *
 * @remarks
 * Every document is opened first, so a wrong data key fails the run before anything is written.
 *
 * @param apply - Whether to write. A dry run only counts.
 * @returns What was found and written.
 * @throws If the database operation fails, or a stored value fails to open.
 */
export async function sealPlaintextDocuments(apply: boolean): Promise<MigrationReport> {
  const users = await storedUsers().find().toArray();
  const trips = await storedTrips().find().toArray();
  users.forEach(openUser);
  trips.forEach(openTrip);

  const userWrites = users.flatMap((stored) => {
    const changes = userChanges(stored);
    return changes === null ? [] : [{ stored, changes }];
  });
  const tripWrites = trips.flatMap((stored) => {
    const changes = tripChanges(stored);
    return changes === null ? [] : [{ stored, changes }];
  });
  const report: MigrationReport = { users: userWrites.length, trips: tripWrites.length, sealed: 0, changedDuringRun: 0 };
  if (!apply) return report;

  const results = await Promise.all([
    ...userWrites.map(({ stored, changes }) => storedUsers().updateOne(unchangedSince(stored), { $set: changes })),
    ...tripWrites.map(({ stored, changes }) => storedTrips().updateOne(unchangedSince(stored), { $set: changes })),
  ]);
  report.sealed = results.filter((result) => result.modifiedCount === 1).length;
  report.changedDuringRun = results.length - report.sealed;
  return report;
}
