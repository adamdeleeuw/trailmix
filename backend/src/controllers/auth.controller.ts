import type { Request, Response } from 'express';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { toUserResponse } from '../models/user.model';
import { verifyGoogleIdToken, type GoogleProfile } from '../services/google.service';
import { createSession, deleteSession } from '../services/session.service';
import { upsertGoogleUser } from '../services/user.service';

const OK = 200;
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;

/**
 * Signs in with Google, creating the account on first sign-in.
 *
 * @remarks
 * `POST /api/auth/google`, body `{ idToken }`.
 * - `200 { sessionToken, user }`: signed in, where `user` is a `UserResponse` (see `toUserResponse`).
 * - `400 { error }`: `idToken` is missing or not a non-empty string.
 * - `401 { error }`: Google rejected the token.
 * - `500 { error }`: database error.
 */
export async function signInWithGoogle(req: Request, res: Response): Promise<void> {
  const idToken: unknown = req.body?.idToken; // ?. so a missing body doesn't crash
  if (typeof idToken !== 'string' || idToken.length === 0) {
    res.status(BAD_REQUEST).json({ error: 'No idToken' });
    return;
  }

  let profile: GoogleProfile;
  try {
    profile = await verifyGoogleIdToken(idToken);
  } catch {
    // don't leak why verification failed
    res.status(UNAUTHORIZED).json({ error: 'Invalid credentials' });
    return;
  }

  const user = await upsertGoogleUser(profile);
  const sessionToken = await createSession(user._id);
  res.status(OK).json({ sessionToken, user: toUserResponse(user) });
}

/**
 * Ends the session that made the request, leaving the user's other devices signed in.
 *
 * @remarks
 * `POST /api/auth/sign-out`, requires a session.
 * - `204`: signed out.
 * - `401 { error }`: no valid session.
 * - `500 { error }`: database error.
 */
export async function signOut(_req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  await deleteSession(res.locals.auth.sessionId);
  res.status(NO_CONTENT).end();
}
