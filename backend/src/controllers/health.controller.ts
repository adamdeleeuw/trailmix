import { type Request, type Response } from 'express';
import mongoose from 'mongoose';

const SERVICE_UNAVAILABLE = 503;

/**
 * Reports whether the backend can serve requests, for the deploy script and uptime checks.
 *
 * @remarks
 * `GET /health`, no session.
 * - `200 { status: "ok" }`: connected to MongoDB.
 * - `503 { status: "unavailable" }`: MongoDB is unreachable, so a deploy with a dead database fails loudly.
 */
export function getHealth(_req: Request, res: Response): void {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected) {
    res.status(SERVICE_UNAVAILABLE).json({ status: 'unavailable' });
    return;
  }
  res.json({ status: 'ok' });
}
