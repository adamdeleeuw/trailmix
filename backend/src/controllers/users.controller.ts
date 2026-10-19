import type { Request, Response } from 'express';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { toUserResponse } from '../models/user.model';
import { deleteUserSessions } from '../services/session.service';
import { findTripsByUserId } from '../services/trip.service';
import { deleteUser, saveGasPrice as saveUserGasPrice, saveUserProfile } from '../services/user.service';
import { parseGasPrice } from '../validation/gas-price.validation';
import { parseProfile } from '../validation/profile.validation';

const OK = 200;
const NO_CONTENT = 204;
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

/**
 * Saves the signed-in user's last gas price, stamped with the current time.
 *
 * @remarks
 * `PUT /api/users/me/gas-price`, requires a session. The body is `{ centsPerLitre }`
 * (see `parseGasPrice`). The server sets `savedAt`, not the app.
 * - `200 { user }`: the updated `UserResponse`, with `lastGasPrice` set.
 * - `400 { error }`: the price is missing or invalid, and nothing is saved.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `500 { error }`: database error.
 */
export async function saveGasPrice(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const centsPerLitre = parseGasPrice(req.body);
  if (centsPerLitre === undefined) {
    res.status(BAD_REQUEST).json({ error: 'Invalid gas price' });
    return;
  }

  const user = await saveUserGasPrice(res.locals.auth.user._id, centsPerLitre);
  if (user === null) {
    res.status(UNAUTHORIZED).json({ error: 'Unauthorized' }); // deleted after the session check
    return;
  }
  res.status(OK).json({ user: toUserResponse(user) });
}

/**
 * Permanently deletes the signed-in user's account and signs them out on every device.
 *
 * @remarks
 * `DELETE /api/users/me`, requires a session. The user is deleted before their
 * sessions, so if deleting the sessions fails they already stop working:
 * `requireSession` rejects a session whose account no longer exists.
 * - `204`: deleted.
 * - `401 { error }`: no valid session.
 * - `500 { error }`: database error.
 */
export async function deleteMe(_req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const userId = res.locals.auth.user._id;
  await deleteUser(userId);
  await deleteUserSessions(userId);
  res.status(NO_CONTENT).end();
}
