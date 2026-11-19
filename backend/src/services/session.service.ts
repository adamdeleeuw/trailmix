import { createHash, randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import { SESSION_IDLE_DAYS, SESSION_MAX_DAYS, SessionModel, type Session } from '../models/session.model';

// 256 bits: far too many to guess, so a fast unsalted hash is safe to store
const TOKEN_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;

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
 * Looks up the unexpired session a token belongs to.
 *
 * @remarks
 * Checks both expiry rules itself, so an expired session is refused at once rather
 * than whenever MongoDB's TTL monitor next deletes it.
 *
 * @param token - The session token sent by the app.
 * @returns The session, or `null` if the token matches none, or only an expired one.
 * @throws If the database operation fails.
 */
export async function findSessionByToken(token: string): Promise<Session | null> {
  const now = Date.now();
  return SessionModel.findOne({
    tokenHash: hashToken(token),
    createdAt: { $gt: new Date(now - SESSION_MAX_DAYS * DAY_MS) },
    // $not also matches a session from before lastUsedAt existed, which then gets one at its first use
    lastUsedAt: { $not: { $lte: new Date(now - SESSION_IDLE_DAYS * DAY_MS) } },
  }).lean();
}

/**
 * Records that a session was just used, which restarts its 30 days of idle time.
 *
 * @remarks
 * Writes at most once a day per session, so active users don't cause a write on every request.
 *
 * @param session - A session {@link findSessionByToken} returned.
 * @throws If the database operation fails.
 */
export async function recordSessionUse(session: Session): Promise<void> {
  const now = Date.now();
  if (session.lastUsedAt !== undefined && now - session.lastUsedAt.getTime() < DAY_MS) return;
  await SessionModel.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date(now) } });
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

/**
 * Ends every session a user has, signing them out on every device.
 *
 * @param userId - The user whose sessions end.
 * @throws If the database operation fails.
 */
export async function deleteUserSessions(userId: Types.ObjectId): Promise<void> {
  await SessionModel.deleteMany({ userId });
}
