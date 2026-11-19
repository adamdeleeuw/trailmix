import type { Request, Response } from 'express';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { reservePlan } from '../services/plan-quota.service';
import { planTrip } from '../services/planner.service';
import { RouteServiceUnavailableError } from '../services/planner.google.service';
import { parsePlanRequest } from '../validation/plan-request.validation';

const OK = 200;
const BAD_REQUEST = 400;
const SERVICE_UNAVAILABLE = 503;

/**
 * Plans up to three options using the user's costs, preferences, and saved parking spots.
 *
 * @remarks
 * `POST /api/routes/plan`, requires a session.
 * - `200 { options }`: planned.
 * - `400 { error }`: the request body is invalid.
 * - `429 { error }` with `Retry-After`: the user or their address has planned too often.
 * - `503 { error, code: "PLAN_LIMIT_REACHED" }` with `Retry-After`: all users together reached today's or this
 *   month's cap, which bounds the Google bill.
 * - `503 { error }`: Google couldn't be reached.
 */
export async function planRoute(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const parsed = parsePlanRequest(req.body);
  if ('error' in parsed) {
    res.status(BAD_REQUEST).json({ error: parsed.error });
    return;
  }
  const retryAfter = await reservePlan(); // after validation, so a bad request doesn't use up the shared cap
  if (retryAfter !== undefined) {
    res.set('Retry-After', String(retryAfter)).status(SERVICE_UNAVAILABLE)
      .json({ error: 'Trip planning has reached its limit', code: 'PLAN_LIMIT_REACHED' });
    return;
  }
  try {
    const result = await planTrip(res.locals.auth.user._id, res.locals.auth.user, parsed.request);
    res.status(OK).json(result);
  } catch (error) {
    if (!(error instanceof RouteServiceUnavailableError)) throw error;
    res.status(SERVICE_UNAVAILABLE).json({ error: "Couldn't reach the route service" });
  }
}