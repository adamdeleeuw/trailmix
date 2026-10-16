import type { NextFunction, Request, Response } from 'express';

const BAD_REQUEST = 400;
const INTERNAL_SERVER_ERROR = 500;

/**
 * Last-resort error handler, so a failure never crashes the server.
 *
 * @remarks
 * Express 5 forwards rejected async handlers here. A request body that isn't
 * valid JSON gets `400 { error }`, and anything else (e.g. a database outage)
 * gets `500 { error }` without leaking details. If the response has already
 * started, Express's default handler takes over and closes the connection.
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

  console.error(err);
  res.status(INTERNAL_SERVER_ERROR).json({ error: 'Internal Server Error' });
}
