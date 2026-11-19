import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';

const BAD_REQUEST = 400;
const INTERNAL_SERVER_ERROR = 500;
const SERVICE_UNAVAILABLE = 503;

// whether [err] means MongoDB can't be reached right now, rather than a bug or a bad query
function isDatabaseUnavailable(err: unknown): boolean {
  return (
    err instanceof mongoose.mongo.MongoNetworkError ||
    err instanceof mongoose.mongo.MongoServerSelectionError ||
    err instanceof mongoose.Error.MongooseServerSelectionError ||
    // while disconnected, Mongoose buffers queries and then fails them with a plain MongooseError
    mongoose.connection.readyState !== mongoose.ConnectionStates.connected
  );
}

/**
 * Last-resort error handler, so a failure never crashes the server.
 *
 * @remarks
 * Express 5 forwards rejected async handlers here. A request body that isn't
 * valid JSON gets `400 { error }`, a database outage gets `503 { error }` so the
 * app can say to try again shortly, and anything else gets `500 { error }`.
 * None of them leak details. If the response has already started, Express's
 * default handler takes over and closes the connection.
 */
export function handleError(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  // a status and body can't be sent after headers have gone out
  if (res.headersSent) {
    next(err);
    return;
  }

  // express.json() reports an unparseable body as a SyntaxError
  if (err instanceof SyntaxError) {
    res.status(BAD_REQUEST).json({ error: 'Malformed JSON' });
    return;
  }

  // the name and code only, since a Mongoose validation message can quote the user data that failed (#89)
  const { name, code } = err instanceof Error ? (err as Error & { code?: unknown }) : { name: typeof err, code: undefined };
  console.error('Request failed:', name, code ?? '');
  if (isDatabaseUnavailable(err)) {
    res.status(SERVICE_UNAVAILABLE).json({ error: 'Service temporarily unavailable' });
    return;
  }
  res.status(INTERNAL_SERVER_ERROR).json({ error: 'Internal Server Error' });
}
