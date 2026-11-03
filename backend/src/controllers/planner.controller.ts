import type { Request, Response } from 'express';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { planTrip } from '../services/planner.service';
import { RouteServiceUnavailableError } from '../services/planner.google.service';
import { parsePlanRequest } from '../validation/plan-request.validation';

const OK = 200;
const BAD_REQUEST = 400;
const SERVICE_UNAVAILABLE = 503;

/** Plans up to three options using the user's costs, preferences, and saved parking spots. */
export async function planRoute(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const parsed = parsePlanRequest(req.body);
  if ('error' in parsed) {
    res.status(BAD_REQUEST).json({ error: parsed.error });
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