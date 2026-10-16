import { createHash, randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import { SessionModel, type Session } from '../models/session.model';

// 256 bits: far too many to guess, so a fast unsalted hash is safe to store
const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Starts a new session for a user.
 *
 * @param userId - The user signing in.
 * @returns The session token for the app. Only its hash is stored, so this is
 * the only time the raw token exists on the server.
 * @throws If the database operation fails.
 */
export async function createSession(userId: Types.ObjectId): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await SessionModel.create({ tokenHash: hashToken(token), userId });
  return token;
}

/**
 * Looks up the session a token belongs to.
 *
 * @param token - The session token sent by the app.
 * @returns The session, or `null` if the token doesn't match one.
 * @throws If the database operation fails.
 */
export async function findSessionByToken(token: string): Promise<Session | null> {
  return SessionModel.findOne({ tokenHash: hashToken(token) }).lean();
}

/**
 * Ends one session. The user's other sessions are not affected.
 *
 * @param sessionId - The session to end.
 * @throws If the database operation fails.
 */
export async function deleteSession(sessionId: Types.ObjectId): Promise<void> {
  await SessionModel.deleteOne({ _id: sessionId });
}
