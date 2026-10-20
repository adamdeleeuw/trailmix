import type { Request, Response } from 'express';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { toUserResponse } from '../models/user.model';
import { findTripsByUserId } from '../services/trip.service';
import { saveUserProfile } from '../services/user.service';
import { parseProfile } from '../validation/profile.validation';

const OK = 200;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;

/**
 * Returns the signed-in user's account, which the app fetches on launch.
 *
 * @remarks
 * `GET /api/users/me`, requires a session.
 * - `200 { user }`: `user` is a `UserResponse` (see `toUserResponse`).
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `500 { error }`: database error.
 */
export function getMe(_req: Request, res: Response<unknown, AuthLocals>): void {
  res.status(OK).json({ user: toUserResponse(res.locals.auth.user) });
}

/** Returns the signed-in user's trip history, newest first. */
export async function getMyTrips(_req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const trips = await findTripsByUserId(res.locals.auth.user._id);
  res.status(OK).json({ trips });
}

/**
 * Saves the signed-in user's questionnaire answers and marks their profile as finished.
 *
 * @remarks
 * `PUT /api/users/me/profile`, requires a session. The body is
 * `{ timezone, vehicle, transit }` (see `parseProfile`), and it replaces the whole profile.
 * - `200 { user }`: the updated `UserResponse`.
 * - `400 { error }`: an answer is missing or invalid, and nothing is saved.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `500 { error }`: database error.
 */
export async function saveProfile(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const profile = parseProfile(req.body);
  if (profile === undefined) {
    res.status(BAD_REQUEST).json({ error: 'Invalid profile' });
    return;
  }

  const user = await saveUserProfile(res.locals.auth.user._id, profile);
  if (user === null) {
    res.status(UNAUTHORIZED).json({ error: 'Unauthorized' }); // deleted after the session check
    return;
  }
  res.status(OK).json({ user: toUserResponse(user) });
}
