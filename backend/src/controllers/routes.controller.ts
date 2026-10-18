import type { Request, Response } from 'express';
import { computeRoute, type LatLng } from '../services/routes.service';

const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
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

/**
 * Plans a chained commute: drive from the start to the split point, then transit to the destination. Somewhat hardcoded right now, will be turned into algo at later checkpoints
 */
export async function planChainedRoute(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body; // undefined if the request had no JSON body
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const start = parsePoint(fields.start);
  const split = parsePoint(fields.split);
  const destination = parsePoint(fields.destination);

  if (start === null || split === null || destination === null) {
    res.status(BAD_REQUEST).json({ error: 'start, split and destination must each be { lat, lng }' });
    return;
  }

  // the two legs don't depend on each other, so ask for both at once
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