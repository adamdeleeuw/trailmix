import { UserModel, type User } from '../../src/models/user.model';
import { lookupHash } from '../../src/services/field-crypto';
import { createSession } from '../../src/services/session.service';
import { sealSpot, sealUserFields, storedUsers } from '../../src/services/user.service';

let nextGoogleId = 0;

/**
 * Adds a user straight to the test database, sealed the way the services store it, and signs them in, so tests
 * don't need Google.
 *
 * @param overrides - Fields to set on the user instead of the defaults.
 * @returns The stored user and a valid session token for them.
 */
export async function createSignedInUser(
  overrides: Partial<Omit<User, '_id'>> = {},
): Promise<{ user: User; token: string }> {
  nextGoogleId += 1;
  const doc = new UserModel({
    googleId: `google-${nextGoogleId}`,
    email: `user${nextGoogleId}@example.com`,
    name: `Test User ${nextGoogleId}`,
    ...overrides,
  });
  await doc.validate();
  const now = new Date();
  const user: User = { ...doc.toObject(), createdAt: now, updatedAt: now };
  await storedUsers().insertOne({
    ...sealUserFields(user._id, { ...user }),
    _id: user._id,
    googleId: lookupHash(user.googleId),
    parkingSpots: user.parkingSpots.map((spot) => sealSpot(user._id, spot)),
  });
  const token = await createSession(user._id);
  return { user, token };
}

/** Builds the `Authorization` header value for a session token. */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}
