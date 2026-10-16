import { UserModel, type User } from '../../src/models/user.model';
import { createSession } from '../../src/services/session.service';

let nextGoogleId = 0;

/**
 * Adds a user straight to the test database and signs them in, so tests don't
 * need Google.
 *
 * @param overrides - Fields to set on the user instead of the defaults.
 * @returns The stored user and a valid session token for them.
 */
export async function createSignedInUser(
  overrides: Partial<Omit<User, '_id'>> = {},
): Promise<{ user: User; token: string }> {
  nextGoogleId += 1;
  const doc = await UserModel.create({
    googleId: `google-${nextGoogleId}`,
    email: `user${nextGoogleId}@example.com`,
    name: `Test User ${nextGoogleId}`,
    ...overrides,
  });
  const user = doc.toObject();
  const token = await createSession(user._id);
  return { user, token };
}

/** Builds the `Authorization` header value for a session token. */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}
