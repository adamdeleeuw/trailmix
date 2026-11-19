import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { advanceClock, setClock } from '../helpers/clock';
import { useTestDatabase } from '../helpers/db';
import { fakeGoogleRoutes, TRANSIT_PLAN } from '../helpers/google';

useTestDatabase();

// Wednesday 2026-11-18 at noon in B.C., which has been a fixed UTC-7 since 2026 (see bc-time.ts)
const NOON_BC = '2026-11-18T19:00:00Z';
const NEXT_MIDNIGHT_BC = Date.parse('2026-11-19T07:00:00Z');
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

jest.setTimeout(60_000);

beforeEach(() => {
  setClock(NOON_BC);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete process.env.PLAN_DAILY_CAP;
  delete process.env.PLAN_MONTHLY_CAP;
});

// sends one plan request as [token], from the client address [ip] (Caddy passes it on in X-Forwarded-For)
function plan(app: Express, token: string, ip = '203.0.113.1'): request.Test {
  return request(app).post('/api/routes/plan').set('Authorization', bearer(token)).set('X-Forwarded-For', ip)
    .send(TRANSIT_PLAN);
}

// sends [count] plans one after another and expects every one to succeed
async function planOk(app: Express, token: string, count: number, ip?: string): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const response = await plan(app, token, ip);
    expect(response.status).toBe(200);
  }
}

// seconds from now until [instant]
function secondsUntil(instant: number): number {
  return Math.ceil((instant - Date.now()) / 1000);
}

function expectGenericTooMany(response: request.Response): void {
  expect(response.status).toBe(429);
  expect(Object.keys(response.body as object)).toEqual(['error']);
  expect(typeof response.body.error).toBe('string');
}

// the number of Google calls one plan of TRANSIT_PLAN makes, measured on its own app so it touches no limit
async function googleCallsPerPlan(google: jest.SpiedFunction<typeof fetch>): Promise<number> {
  const { token } = await createSignedInUser();
  const before = google.mock.calls.length;
  await planOk(createApp(), token, 1, '198.51.100.250');
  return google.mock.calls.length - before;
}

// Interface POST /api/routes/plan (decisions 4 and 5: per-user, per-IP and all-users plan limits)
describe('Mocked: POST /api/routes/plan limits', () => {
  // Mocked behavior: Google answers every call; the clock is stopped at noon in B.C.
  // Input: 11 plans from one user within a minute
  // Expected status code: 200 for the first 10, then 429
  // Expected behavior: the 11th is refused before any Google call
  // Expected output: { error } only, with Retry-After of 1 to 60 seconds
  test("Refuses one user's 11th plan within a minute", async () => {
    const google = fakeGoogleRoutes();
    const app = createApp();
    const { token } = await createSignedInUser();
    await planOk(app, token, 10);
    const callsBefore = google.mock.calls.length;

    const response = await plan(app, token);

    expectGenericTooMany(response);
    const retryAfter = Number(response.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(google.mock.calls.length).toBe(callsBefore);
  });

  // Mocked behavior: Google answers every call
  // Input: one user uses up their minute, then a different user plans in that same minute
  // Expected status code: 200 for the second user
  // Expected behavior: one user's limit doesn't affect anyone else
  // Expected output: planned options
  test('Lets a different user plan in that same minute', async () => {
    fakeGoogleRoutes();
    const app = createApp();
    const first = await createSignedInUser();
    const second = await createSignedInUser();
    await planOk(app, first.token, 10);
    expect((await plan(app, first.token)).status).toBe(429);

    const response = await plan(app, second.token);

    expect(response.status).toBe(200);
  });

  // Mocked behavior: Google answers every call; the clock moves forward 61 seconds
  // Input: one user uses up their minute, waits for it to pass, then plans again
  // Expected status code: 200
  // Expected behavior: the minute limit resets
  // Expected output: planned options
  test('Lets the user plan again after the minute passes', async () => {
    fakeGoogleRoutes();
    const app = createApp();
    const { token } = await createSignedInUser();
    await planOk(app, token, 10);
    expect((await plan(app, token)).status).toBe(429);
    advanceClock(MINUTE_MS + 1000);

    const response = await plan(app, token);

    expect(response.status).toBe(200);
  });

  // Mocked behavior: Google answers every call; the clock moves forward a minute after each 10 plans
  // Input: 21 plans from one user on the same day
  // Expected status code: 200 for the first 20, then 429
  // Expected behavior: the 21st is refused before any Google call
  // Expected output: { error } only, with Retry-After running to midnight B.C. time
  test("Refuses one user's 21st plan in a day", async () => {
    const google = fakeGoogleRoutes();
    const app = createApp();
    const { token } = await createSignedInUser();
    await planOk(app, token, 10);
    advanceClock(MINUTE_MS + 1000);
    await planOk(app, token, 10);
    advanceClock(MINUTE_MS + 1000);
    const callsBefore = google.mock.calls.length;

    const response = await plan(app, token);

    expectGenericTooMany(response);
    expect(Number(response.headers['retry-after'])).toBe(secondsUntil(NEXT_MIDNIGHT_BC));
    expect(google.mock.calls.length).toBe(callsBefore);
  });

  // Mocked behavior: Google answers every call
  // Input: 60 plans from four users on four addresses, then a 61st from a fifth user on a fifth address
  // Expected status code: 200 for the first 60, then 503
  // Expected behavior: the shared daily cap refuses the 61st before any Google call
  // Expected output: { error, code: "PLAN_LIMIT_REACHED" }, with Retry-After running to midnight B.C. time
  test('Refuses the 61st plan of the day across all users', async () => {
    const google = fakeGoogleRoutes();
    const app = createApp();
    for (let user = 0; user < 4; user += 1) {
      const { token } = await createSignedInUser();
      await planOk(app, token, 10, `203.0.113.${user}`);
      advanceClock(MINUTE_MS + 1000);
      await planOk(app, token, 5, `203.0.113.${user}`);
    }
    const { token } = await createSignedInUser();
    const callsBefore = google.mock.calls.length;

    const response = await plan(app, token, '203.0.113.99');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(typeof response.body.error).toBe('string');
    expect(Number(response.headers['retry-after'])).toBe(secondsUntil(NEXT_MIDNIGHT_BC));
    expect(google.mock.calls.length).toBe(callsBefore);
  });

  // Mocked behavior: Google answers every call; the shared caps are lowered in the environment to 2 a day and
  // 3 a month, the way an operator would set them in backend/.env
  // Input: 2 plans today, then 2 tomorrow
  // Expected status code: 200, 200, then 200 and 503 tomorrow
  // Expected behavior: the monthly cap holds even after the daily count resets
  // Expected output: { error, code: "PLAN_LIMIT_REACHED" }, with Retry-After running to the 1st of next month
  test('Refuses plans past the monthly cap until the 1st of next month', async () => {
    process.env.PLAN_DAILY_CAP = '2';
    process.env.PLAN_MONTHLY_CAP = '3';
    fakeGoogleRoutes();
    const { token } = await createSignedInUser();
    await planOk(createApp(), token, 2);
    advanceClock(DAY_MS);
    await planOk(createApp(), token, 1);

    const response = await plan(createApp(), token);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PLAN_LIMIT_REACHED');
    // December 1st at midnight in B.C.
    expect(Number(response.headers['retry-after'])).toBe(secondsUntil(Date.parse('2026-12-01T07:00:00Z')));
  });

  // Mocked behavior: Google answers every call; the daily cap is lowered to 3 in the environment
  // Input: 3 plans on one app instance, then a plan on a fresh instance (a restart or deploy)
  // Expected status code: 503 on the fresh instance
  // Expected behavior: the shared counts survive a restart
  // Expected output: { error, code: "PLAN_LIMIT_REACHED" }
  test('Keeps the shared counts after a restart', async () => {
    process.env.PLAN_DAILY_CAP = '3';
    fakeGoogleRoutes();
    const { token } = await createSignedInUser();
    await planOk(createApp(), token, 3);

    const response = await plan(createApp(), token);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  // Mocked behavior: Google answers every call
  // Input: 30 plans from one user, all sent at once
  // Expected status code: exactly 10 200s and 20 429s
  // Expected behavior: concurrent requests can't slip past the limit, and only the 10 accepted plans call Google
  // Expected output: planned options or { error } with Retry-After
  test('Holds the per-user limit against a concurrent burst', async () => {
    const google = fakeGoogleRoutes();
    const perPlan = await googleCallsPerPlan(google);
    const app = createApp();
    const { token } = await createSignedInUser();
    const callsBefore = google.mock.calls.length;

    const responses = await Promise.all(Array.from({ length: 30 }, () => plan(app, token)));

    expect(responses.filter((response) => response.status === 200)).toHaveLength(10);
    const refused = responses.filter((response) => response.status === 429);
    expect(refused).toHaveLength(20);
    for (const response of refused) expect(response.headers['retry-after']).toBeDefined();
    expect(google.mock.calls.length - callsBefore).toBe(10 * perPlan);
  });

  // Mocked behavior: Google answers every call
  // Input: 50 plans today, then 20 plans from 20 users on 20 addresses, all sent at once
  // Expected status code: exactly 10 200s and 10 503s
  // Expected behavior: concurrent requests can't push the shared daily count past 60
  // Expected output: planned options or { error, code: "PLAN_LIMIT_REACHED" }
  test('Holds the shared daily cap against a concurrent burst', async () => {
    fakeGoogleRoutes();
    const app = createApp();
    for (let user = 0; user < 5; user += 1) {
      const { token } = await createSignedInUser();
      await planOk(app, token, 10, `203.0.113.${user}`);
    }
    const tokens = await Promise.all(Array.from({ length: 20 }, async () => (await createSignedInUser()).token));

    const responses = await Promise.all(tokens.map((token, index) => plan(app, token, `198.51.100.${index}`)));

    expect(responses.filter((response) => response.status === 200)).toHaveLength(10);
    const refused = responses.filter((response) => response.status === 503);
    expect(refused).toHaveLength(10);
    for (const response of refused) expect(response.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  // Mocked behavior: Google answers every call
  // Input: 30 plans from four users on one address within an hour, then a plan from a fifth user on that address
  // Expected status code: 429 for the 31st
  // Expected behavior: one address can't drain the shared cap with several accounts, and the 31st calls no Google
  // Expected output: { error } only, with Retry-After
  test('Refuses the 31st plan in an hour from one address', async () => {
    const google = fakeGoogleRoutes();
    const app = createApp();
    for (const count of [8, 8, 8, 6]) {
      const { token } = await createSignedInUser();
      await planOk(app, token, count);
    }
    const { token } = await createSignedInUser();
    const callsBefore = google.mock.calls.length;

    const response = await plan(app, token);

    expectGenericTooMany(response);
    expect(response.headers['retry-after']).toBeDefined();
    expect(google.mock.calls.length).toBe(callsBefore);
  });
});
