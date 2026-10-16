import type { NextFunction, Request, Response } from 'express';
import type { Types } from 'mongoose';
import type { User } from '../models/user.model';
import { findSessionByToken } from '../services/session.service';
import { findUserById } from '../services/user.service';

const UNAUTHORIZED = 401;

/** What {@link requireSession} puts in `res.locals` for the handlers after it. */
export interface AuthLocals {
  auth: {
    user: User;
    sessionId: Types.ObjectId;
  };
}

/**
 * Rejects requests without a valid session.
 *
 * @remarks
 * Expects `Authorization: Bearer <session token>`. Responds `401 { error }` if
 * the header is missing or malformed, the token matches no session, or the
 * session's account no longer exists. Otherwise it sets `res.locals.auth` and
 * calls the next handler. Database errors go to the error handler.
 */
export async function requireSession(
  req: Request,
  res: Response<unknown, AuthLocals>,
  next: NextFunction,
): Promise<void> {
  const token = req.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  const session = token === undefined ? null : await findSessionByToken(token);
  const user = session === null ? null : await findUserById(session.userId);

  if (session === null || user === null) {
    res.status(UNAUTHORIZED).json({ error: 'Unauthorized' });
    return;
  }

  res.locals.auth = { user, sessionId: session._id };
  next();
}
