import type { Request, Response } from 'express';
import { computeRoute, type LatLng } from '../services/legacy-routes.service';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { planTrip } from '../services/planner.service';
import { RouteServiceUnavailableError } from '../services/planner.google.service';
import { parsePlanRequest } from '../validation/plan-request.validation';

const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const SERVICE_UNAVAILABLE = 503;
const MAX_LAT = 90;
const MAX_LNG = 180;

/** Reads `{ lat, lng }` from untrusted JSON, or `null` if it isn't a valid point. */
function parsePoint(value: unknown): LatLng | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { lat, lng } = value as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return null;
  }
  if (Math.abs(lat) > MAX_LAT || Math.abs(lng) > MAX_LNG) {
    return null;
  }
  return { lat, lng };
}

/** Legacy handler retained while the app migrates away from `/api/routes/chained`. */
export async function planLegacyChainedRoute(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const start = parsePoint(fields.start);
  const split = parsePoint(fields.split);
  const destination = parsePoint(fields.destination);

  if (start === null || split === null || destination === null) {
    res.status(BAD_REQUEST).json({ error: 'start, split and destination must each be { lat, lng }' });
    return;
  }

  const [driveLeg, transitLeg] = await Promise.all([
    computeRoute(start, split, 'DRIVE'),
    computeRoute(split, destination, 'TRANSIT'),
  ]);

  if (driveLeg === null || transitLeg === null) {
    res.status(NOT_FOUND).json({ error: 'No route found' });
    return;
  }

  res.status(OK).json({
    legs: [driveLeg, transitLeg],
    totalDurationSeconds: driveLeg.durationSeconds + transitLeg.durationSeconds,
  });
}

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