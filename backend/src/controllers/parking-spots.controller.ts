import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import type { AuthLocals } from '../middleware/require-session.middleware';
import { toParkingSpotResponse } from '../models/user.model';
import {
  deleteParkingSpot,
  getParkingSpots,
  saveParkingSpot,
  updateParkingSpot,
  type ParkingSpotResult,
} from '../services/parking-spot.service';
import { parseNewParkingSpot, parseParkingSpotDetails } from '../validation/parking-spot.validation';

const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const CONFLICT = 409;

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i; // stricter than Types.ObjectId.isValid, which accepts any 12-character string

const NOT_FOUND_ERROR = 'Parking spot not found';

/** The status and error a rejected save or edit is sent as. */
function rejectionFor(status: Exclude<ParkingSpotResult['status'], 'SAVED'>): { status: number; error: string } {
  switch (status) {
    case 'NO_USER':
      return { status: UNAUTHORIZED, error: 'Unauthorized' }; // deleted after the session check
    case 'NOT_FOUND':
      return { status: NOT_FOUND, error: NOT_FOUND_ERROR };
    case 'LIMIT_REACHED':
      return { status: CONFLICT, error: 'Parking spot limit reached' };
    case 'DUPLICATE':
      return { status: CONFLICT, error: 'Parking spot already saved' };
  }
}

/** Reads the `:id` path parameter, or `undefined` if it isn't a MongoDB ID. */
function parseSpotId(req: Request): Types.ObjectId | undefined {
  const { id } = req.params;
  return typeof id === 'string' && OBJECT_ID_PATTERN.test(id) ? new Types.ObjectId(id) : undefined;
}

/** Sends a saved spot with the given status, or the error for why it wasn't saved. */
function sendResult(res: Response, result: ParkingSpotResult, successStatus: number): void {
  if (result.status === 'SAVED') {
    res.status(successStatus).json({ parkingSpot: toParkingSpotResponse(result.spot) });
    return;
  }
  const { status, error } = rejectionFor(result.status);
  res.status(status).json({ error });
}

/**
 * Returns the signed-in user's parking spots, which the Map tab shows as P markers.
 *
 * @remarks
 * `GET /api/users/me/parking-spots`, requires a session.
 * - `200 { parkingSpots }`: newest first, each a `ParkingSpotResponse`; empty for a new user.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `500 { error }`: database error.
 */
export async function getMyParkingSpots(_req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const spots = await getParkingSpots(res.locals.auth.user._id);
  res.status(OK).json({ parkingSpots: spots.map(toParkingSpotResponse) });
}

/**
 * Saves a new parking spot for the signed-in user.
 *
 * @remarks
 * `POST /api/users/me/parking-spots`, requires a session. The body is
 * `{ label, location, placeId?, rateCents?, ratePer?, overnightAllowed? }` (see `parseNewParkingSpot`).
 * - `201 { parkingSpot }`: the saved `ParkingSpotResponse`, with its new `id`.
 * - `400 { error }`: a field is missing or invalid, and nothing is saved.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `409 { error }`: the user already has 20 spots ("Parking spot limit reached"), or
 *   already saved this `placeId` ("Parking spot already saved").
 * - `500 { error }`: database error.
 */
export async function createParkingSpot(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const spot = parseNewParkingSpot(req.body);
  if (spot === undefined) {
    res.status(BAD_REQUEST).json({ error: 'Invalid parking spot' });
    return;
  }
  sendResult(res, await saveParkingSpot(res.locals.auth.user._id, spot), CREATED);
}

/**
 * Changes the name, cost and overnight rule of one of the signed-in user's parking spots.
 *
 * @remarks
 * `PUT /api/users/me/parking-spots/:id`, requires a session. The body is
 * `{ label, rateCents?, ratePer?, overnightAllowed? }` (see `parseParkingSpotDetails`);
 * the spot's place can't change. Used by the place sheet's Edit button.
 * - `200 { parkingSpot }`: the updated `ParkingSpotResponse`.
 * - `400 { error }`: a field is missing or invalid, and nothing is changed.
 * - `401 { error }`: no valid session, or the account was deleted.
 * - `404 { error }`: the user has no spot with that ID.
 * - `500 { error }`: database error.
 */
export async function editParkingSpot(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const spotId = parseSpotId(req);
  if (spotId === undefined) {
    res.status(NOT_FOUND).json({ error: NOT_FOUND_ERROR });
    return;
  }
  const details = parseParkingSpotDetails(req.body);
  if (details === undefined) {
    res.status(BAD_REQUEST).json({ error: 'Invalid parking spot' });
    return;
  }
  sendResult(res, await updateParkingSpot(res.locals.auth.user._id, spotId, details), OK);
}

/**
 * Deletes one of the signed-in user's parking spots.
 *
 * @remarks
 * `DELETE /api/users/me/parking-spots/:id`, requires a session.
 * - `204`: deleted.
 * - `401 { error }`: no valid session.
 * - `404 { error }`: the user has no spot with that ID, including another user's spot, and nothing changes.
 * - `500 { error }`: database error.
 */
export async function removeParkingSpot(req: Request, res: Response<unknown, AuthLocals>): Promise<void> {
  const spotId = parseSpotId(req);
  const deleted = spotId !== undefined && await deleteParkingSpot(res.locals.auth.user._id, spotId);
  if (!deleted) {
    res.status(NOT_FOUND).json({ error: NOT_FOUND_ERROR });
    return;
  }
  res.status(NO_CONTENT).end();
}
