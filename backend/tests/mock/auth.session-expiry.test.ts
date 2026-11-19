import { LoginTicket, OAuth2Client } from 'google-auth-library';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../src/app';
import { bearer } from '../helpers/auth';
import { advanceClock, setClock } from '../helpers/clock';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

const DAY_MS = 24 * 60 * 60 * 1000;
const SECOND_MS = 1000;

beforeEach(() => {
  setClock('2026-11-18T20:00:00Z');
  // fakes Google's token check: automated tests can't get a real Google token
  jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation((() => Promise.resolve(new LoginTicket('env', {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id.apps.googleusercontent.com',
    iat: 0,
    exp: 0,
    sub: 'google-sub-expiry',
    email: 'ada@example.com',
  }))) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// signs in through the API, the way the app does, and returns the new session token
async function signIn(app: Express): Promise<string> {
  const response = await request(app).post('/api/auth/google').send({ idToken: 'valid' });
  expect(response.status).toBe(200);
  return response.body.sessionToken as string;
}

function getMe(app: Express, token: string): request.Test {
  return request(app).get('/api/users/me').set('Authorization', bearer(token));
}

// Interface every signed-in endpoint (decision 7: sessions end after 30 days unused, or 90 days after sign-in)
describe('Mocked: session expiry', () => {
  // Mocked behavior: Google accepts the sign-in; the clock moves forward
  // Input: a session used once at sign-in, then 29 days later, then unused for 30 days and a second
  // Expected status code: 200 at 29 days, then 401
  // Expected behavior: a session unused for 30 days ends
  // Expected output: { error: "Unauthorized" }
  test('Ends a session unused for 30 days', async () => {
    const app = createApp();
    const token = await signIn(app);
    advanceClock(29 * DAY_MS);
    expect((await getMe(app, token)).status).toBe(200);
    advanceClock(30 * DAY_MS + SECOND_MS);

    const response = await getMe(app, token);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  // Mocked behavior: Google accepts the sign-in; the clock moves forward five days at a time
  // Input: a session used every 5 days until 85 days after sign-in, then at 90 days and a second
  // Expected status code: 200 every time up to 85 days, then 401
  // Expected behavior: use keeps a session alive past 30 days, but never past 90 days after sign-in
  // Expected output: { error: "Unauthorized" }
  test('Keeps a session in use alive past 30 days, but ends it 90 days after sign-in', async () => {
    const app = createApp();
    const token = await signIn(app);
    for (let day = 5; day <= 85; day += 5) {
      advanceClock(5 * DAY_MS);
      expect((await getMe(app, token)).status).toBe(200);
    }
    advanceClock(5 * DAY_MS + SECOND_MS);

    const response = await getMe(app, token);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  // Mocked behavior: Google accepts both sign-ins; the clock moves forward 31 days
  // Input: a session that has expired, then a new sign-in
  // Expected status code: 401 for the old session, 200 for the new one
  // Expected behavior: signing in again after expiry works as normal
  // Expected output: the user
  test('Lets the user sign in again after expiry', async () => {
    const app = createApp();
    const oldToken = await signIn(app);
    advanceClock(31 * DAY_MS);
    expect((await getMe(app, oldToken)).status).toBe(401);

    const newToken = await signIn(app);
    const response = await getMe(app, newToken);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('ada@example.com');
  });
});
