import express, { type Express, type Request, type Response } from 'express';
import { handleError } from './middleware/error-handler.middleware';
import authRoute from './routes/auth.route';
import healthRoute from './routes/health.route';
import usersRoute from './routes/users.route';
import routesRoute from './routes/routes.route';

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

  // middleware: allows for defined req.body access
  app.use(express.json());

  app.use('/health', healthRoute);
  app.use('/api/auth', authRoute);
  app.use('/api/users', usersRoute);
  app.use('/api/routes', routesRoute);

  app.use((_req: Request, res: Response) => {
    res.status(NOT_FOUND).json({ error: 'Not Found' });
  });

  app.use(handleError);

  return app;
}
