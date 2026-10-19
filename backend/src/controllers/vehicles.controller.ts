import type { Request, Response } from 'express';
import { listMakes, listModels } from '../services/vehicle.service';

const OK = 200;
const NOT_FOUND = 404;

/**
 * Lists every car make for the questionnaire's Make dropdown.
 *
 * @remarks
 * `GET /api/vehicles/makes`, requires a session.
 * - `200 { makes }`: make names, sorted alphabetically.
 * - `401 { error }`: no valid session.
 */
export function getMakes(_req: Request, res: Response): void {
  res.status(OK).json({ makes: listMakes() });
}

/**
 * Lists the base models of one make for the questionnaire's Model dropdown.
 *
 * @remarks
 * `GET /api/vehicles/makes/:make/models`, requires a session. The make is only
 * looked up in the in-memory list, so it never reaches the database.
 * - `200 { models }`: model names, sorted alphabetically.
 * - `401 { error }`: no valid session.
 * - `404 { error }`: the make isn't in the list.
 */
export function getModels(req: Request<{ make: string }>, res: Response): void {
  const models = listModels(req.params.make);
  if (models === undefined) {
    res.status(NOT_FOUND).json({ error: 'Unknown make' });
    return;
  }
  res.status(OK).json({ models });
}
