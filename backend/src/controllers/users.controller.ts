import type { Request, Response } from 'express';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { toUserResponse } from '../models/user.model';

const OK = 200;

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
