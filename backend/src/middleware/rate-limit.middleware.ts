import type { NextFunction, Request, Response } from 'express';
import type { AuthLocals } from './require-session.middleware';
import { nextBcMidnight } from '../services/bc-time';

const TOO_MANY_REQUESTS = 429;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const SWEEP_AT_KEYS = 10_000; // finished windows are dropped once this many keys are tracked, so memory stays bounded

/**
 * Counts requests per key in fixed windows, in memory.
 *
 * @remarks
 * Counting is synchronous, so concurrent requests can't slip past a limit between a check and an increment.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; endsAt: number }>();

  /**
   * @param limit - Requests allowed per key in one window.
   * @param windowEnd - When a window that starts at the given instant ends, in epoch milliseconds.
   */
  constructor(private readonly limit: number, private readonly windowEnd: (start: number) => number) {}

  /**
   * Counts one request for [key], unless its window is already full.
   *
   * @returns `undefined` if the request is allowed, or the whole seconds until its window ends.
   */
  take(key: string): number | undefined {
    const now = Date.now();
    let window = this.windows.get(key);
    if (window === undefined || window.endsAt <= now) {
      if (this.windows.size >= SWEEP_AT_KEYS) this.sweep(now);
      window = { count: 0, endsAt: this.windowEnd(now) };
      this.windows.set(key, window);
    }
    if (window.count >= this.limit) return Math.max(1, Math.ceil((window.endsAt - now) / 1000));
    window.count += 1;
    return undefined;
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.endsAt <= now) this.windows.delete(key);
    }
  }
}

const after = (ms: number) => (start: number): number => start + ms;

/** Builds a fresh set of the limits in decision 4, one set per app instance. */
export function createLimiters() {
  return {
    api: new FixedWindowLimiter(300, after(MINUTE_MS)), // per address, every /api request
    signIn: new FixedWindowLimiter(10, after(MINUTE_MS)), // per address
    plansPerAddress: new FixedWindowLimiter(30, after(HOUR_MS)),
    signedInUser: new FixedWindowLimiter(60, after(MINUTE_MS)), // per user, every signed-in request
    plansPerUserMinute: new FixedWindowLimiter(10, after(MINUTE_MS)),
    plansPerUserDay: new FixedWindowLimiter(20, (start) => nextBcMidnight(new Date(start)).getTime()),
  };
}

type Limiters = ReturnType<typeof createLimiters>;

// the app's limiters live in app.locals, so each createApp() (and each test) starts with empty counts
function limiter(req: Request, name: keyof Limiters): FixedWindowLimiter {
  return (req.app.locals.limiters as Limiters)[name];
}

/** Sends `429 { error }` with a `Retry-After` of [retryAfterSeconds]. */
function tooManyRequests(res: Response, retryAfterSeconds: number): void {
  res.set('Retry-After', String(retryAfterSeconds)).status(TOO_MANY_REQUESTS).json({ error: 'Too many requests' });
}

// counts the request against each named limit for [key], and sends 429 at the first one that is full
function isLimited(req: Request, res: Response, names: (keyof Limiters)[], key: string): boolean {
  for (const name of names) {
    const retryAfter = limiter(req, name).take(key);
    if (retryAfter !== undefined) {
      tooManyRequests(res, retryAfter);
      return true;
    }
  }
  return false;
}

/**
 * Builds middleware that limits requests per client address with the named limits.
 *
 * @remarks
 * `req.ip` is the client's address, since `trust proxy` accepts `X-Forwarded-For` only from Caddy.
 */
export function limitPerAddress(...names: (keyof Limiters)[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isLimited(req, res, names, req.ip ?? '')) next();
  };
}

/** Builds middleware that limits signed-in requests per user with the named limits. Runs after `requireSession`. */
export function limitPerUser(...names: (keyof Limiters)[]) {
  return (req: Request, res: Response<unknown, AuthLocals>, next: NextFunction): void => {
    if (!isLimited(req, res, names, res.locals.auth.user._id.toString())) next();
  };
}
