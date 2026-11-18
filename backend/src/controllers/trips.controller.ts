import type { Request, Response } from 'express';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { liveUpdateFor } from '../services/live-updates.service';
import {
  deletePlannedTrip,
  findLiveTrip,
  findTripsByUserId,
  saveTrip,
  updateTripStatus,
  type TripResult,
} from '../services/trip.service';
import { parseObjectId } from '../validation/common.validation';
import { parseFromLeg, parseNewTrip, parseStatusChange } from '../validation/trip.validation';

const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;

const INVALID_TRIP_ERROR = 'Invalid trip';
const NOT_FOUND_ERROR = 'Trip not found';
const ALREADY_ACTIVE_ERROR = 'Another trip is already active'; // the app matches this to ask "End your current trip?"

/** The status and error a rejected trip write is sent as. */
function rejectionFor(status: Exclude<TripResult['status'], 'SAVED'>): { status: number; error: string } {
  switch (status) {
    case 'INVALID':
      return { status: BAD_REQUEST, error: INVALID_TRIP_ERROR };
    case 'NOT_FOUND':
      return { status: NOT_FOUND, error: NOT_FOUND_ERROR };
    case 'ALREADY_ACTIVE':
      return { status: CONFLICT, error: ALREADY_ACTIVE_ERROR };
    case 'NOT_ALLOWED':
      return { status: CONFLICT, error: "Not allowed in the trip's current status" };
  }
}

/** Sends a saved trip with the given status, or the error for why it wasn't saved. */
function sendResult(res: Response, result: TripResult, successStatus: number): void {
  if (result.status === 'SAVED') {
    res.status(successStatus).json({ trip: result.trip });
    return;
  }
  const { status, error } = rejectionFor(result.status);
  res.status(status).json({ error });
}

/**
 * Returns the signed-in user's trips for History, newest first.
 *
 * @remarks
 * `GET /api/users/me/trips`, requires a session.
 * - `200 { trips }`: each a `TripResponse` (see `toTripResponse`), empty for a new user.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `500 { error }`: database error.
 */
export async function getMyTrips(_req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const trips = await findTripsByUserId(res.locals.auth.user._id);
  res.status(OK).json({ trips });
}

/**
 * Saves a route from Trip Preview as a trip, for Save for later or Start.
 *
 * @remarks
 * `POST /api/users/me/trips`, requires a session. The body is
 * `{ option, status, arriveBy?, actualStart? }` (see `parseNewTrip`).
 * - `201 { trip }`: the saved `TripResponse`, PLANNED or ACTIVE.
 * - `400 { error }`: a field is missing or invalid, or the totals don't add up, and nothing is saved.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `409 { error }`: an ACTIVE trip was asked for, but the user already has one.
 * - `500 { error }`: database error.
 */
export async function createTrip(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const newTrip = parseNewTrip(req.body);
  if (newTrip === undefined) {
    res.status(BAD_REQUEST).json({ error: INVALID_TRIP_ERROR });
    return;
  }
  sendResult(res, await saveTrip(res.locals.auth.user._id, newTrip), CREATED);
}

/**
 * Starts one of the signed-in user's planned trips, or ends their active one.
 *
 * @remarks
 * `PATCH /api/users/me/trips/:id`, requires a session. The body is
 * `{ status, actualStart?, actualEnd? }` (see `parseStatusChange`). Used by Start in
 * History, and by End and "End trip early?" in Navigation.
 * - `200 { trip }`: the updated `TripResponse`.
 * - `400 { error }`: the status or time is invalid, or the trip would end before it started.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `404 { error }`: the user has no trip with that ID, including another user's trip.
 * - `409 { error }`: the trip's status can't move to the new one (e.g. it already ended),
 *   or starting it would make a second ACTIVE trip.
 * - `500 { error }`: database error.
 */
export async function changeTripStatus(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const tripId = parseObjectId(req.params.id);
  if (tripId === undefined) {
    res.status(NOT_FOUND).json({ error: NOT_FOUND_ERROR });
    return;
  }
  const change = parseStatusChange(req.body);
  if (change === undefined) {
    res.status(BAD_REQUEST).json({ error: 'Invalid status change' });
    return;
  }
  sendResult(res, await updateTripStatus(res.locals.auth.user._id, tripId, change), OK);
}

/**
 * Deletes one of the signed-in user's planned trips, from History.
 *
 * @remarks
 * `DELETE /api/users/me/trips/:id`, requires a session. Only PLANNED trips can be
 * deleted, so finished trips stay in History and its totals.
 * - `204`: deleted.
 * - `401 { error }`: no valid session.
 * - `404 { error }`: the user has no trip with that ID, including another user's trip.
 * - `409 { error }`: the trip isn't PLANNED, and nothing changes.
 * - `500 { error }`: database error.
 */
export async function removeTrip(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const tripId = parseObjectId(req.params.id);
  const result = tripId === undefined ? 'NOT_FOUND' : await deletePlannedTrip(res.locals.auth.user._id, tripId);
  if (result === 'DELETED') {
    res.status(NO_CONTENT).end();
    return;
  }
  const { status, error } = rejectionFor(result);
  res.status(status).json({ error });
}

/**
 * Returns TransLink's live times and alerts for the signed-in user's active trip, for Navigation (#87).
 *
 * @remarks
 * `GET /api/users/me/trips/:id/live?fromLeg=N`, requires a session. `fromLeg` is the leg the rider is on (default
 * 0); legs before it are done, and once no transit leg is left only alerts are polled. The app polls this every
 * 15 s. The body is a `LiveUpdate` (see `models/live-update.model.ts`); when TransLink can't be used (no key, the
 * daily cap, a refusal, an error, stale or undecodable data) it's `live: false` with the scheduled times.
 * - `200 LiveUpdate`
 * - `400 { error }`: `fromLeg` isn't a leg of the trip.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `404 { error }`: the user has no trip with that ID, including another user's trip.
 * - `409 { error }`: the trip isn't ACTIVE.
 * - `500 { error }`: database error.
 */
export async function getLiveUpdate(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const tripId = parseObjectId(req.params.id);
  if (tripId === undefined) {
    res.status(NOT_FOUND).json({ error: NOT_FOUND_ERROR });
    return;
  }
  const trip = await findLiveTrip(res.locals.auth.user._id, tripId);
  if (trip.status === 'NOT_FOUND') {
    res.status(NOT_FOUND).json({ error: NOT_FOUND_ERROR });
    return;
  }
  if (trip.status === 'NOT_ACTIVE') {
    res.status(CONFLICT).json({ error: 'Trip is not active' });
    return;
  }
  const fromLeg = parseFromLeg(req.query.fromLeg, trip.legs.length);
  if (fromLeg === undefined) {
    res.status(BAD_REQUEST).json({ error: 'Invalid fromLeg' });
    return;
  }
  res.status(OK).json(await liveUpdateFor(tripId.toHexString(), trip.legs, fromLeg));
}
