/**
 * Loads environment variables (`.env.dev`, then `.env`) and exposes validated config.
 *
 * @remarks
 * Secrets are getters so importing the app (e.g. in tests) doesn't throw. Startup
 * calls {@link assertEnv} instead, to fail fast.
 */
import dotenv from 'dotenv';

// first file wins per variable, and real env vars (e.g. from docker compose) win over both
dotenv.config({ path: ['.env.dev', '.env'], quiet: true });

const rawPort = process.env.PORT;
const port =
  rawPort === undefined || rawPort === ''
    ? 3000
    : Number.parseInt(rawPort, 10);

if (Number.isNaN(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${rawPort}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not defined`);
  }
  return value;
}

export const env = {
  port,
  get googleClientId(): string { // must match the server client ID the Android app requests tokens for
    return requireEnv('GOOGLE_BACKEND_CLIENT_ID');
  },
  get mongodbUri(): string { // MongoDB connection string, including the database name
    return requireEnv('MONGODB_URI');
  },
};

/**
 * Checks that every required environment variable is set.
 *
 * @throws If any required variable is missing or empty.
 */
export function assertEnv(): void {
  for (const name of ['GOOGLE_BACKEND_CLIENT_ID', 'MONGODB_URI']) {
    requireEnv(name);
  }
}
