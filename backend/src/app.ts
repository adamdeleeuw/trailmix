import express, { type Express, type Request, type Response } from 'express';
import { handleError } from './middleware/error-handler.middleware';
import { createLimiters, limitPerAddress } from './middleware/rate-limit.middleware';
import authRoute from './routes/auth.route';
import healthRoute from './routes/health.route';
import usersRoute from './routes/users.route';
import vehiclesRoute from './routes/vehicles.route';
import plannerRoute from './routes/planner.route';

const NOT_FOUND = 404;

/**
 * Builds the Express app with every route mounted.
 *
 * @remarks
 * Doesn't connect to the database or listen, so tests can use it directly.
 */
export function createApp(): Express {
  const app = express();
  // trust X-Forwarded-For from Caddy: loopback when it runs on the host, a private
  // docker network address when it runs in compose. the backend port is never
  // public in production, so only Caddy can set that header.
  app.set('trust proxy', ['loopback', 'uniquelocal']);

  app.locals.limiters = createLimiters(); // per app, so a restart (or a test's fresh app) starts with empty counts

  app.use('/health', healthRoute); // before the limits, so the deploy health check is never refused
  // per-address limits come before body parsing and session lookups, so a flood costs no parsing or database work
  app.use('/api', limitPerAddress('api'));
  app.post('/api/auth/google', limitPerAddress('signIn'));
  app.post('/api/routes/plan', limitPerAddress('plansPerAddress'));

  // middleware: allows for defined req.body access
  app.use(express.json());

  app.use('/api/auth', authRoute);
  app.use('/api/users', usersRoute);
  app.use('/api/vehicles', vehiclesRoute);
  app.use('/api/routes', plannerRoute);

  app.use((_req: Request, res: Response) => {
    res.status(NOT_FOUND).json({ error: 'Not Found' });
  });

  app.use(handleError);

  return app;
}
