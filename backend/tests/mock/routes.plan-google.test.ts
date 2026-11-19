import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { googleAnswer, TRANSIT_PLAN, wait } from '../helpers/google';

useTestDatabase();

jest.setTimeout(30_000);

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// sends one plan from a new user on its own address, so no per-user or per-address limit is involved
async function planAsNewUser(app: Express, index: number): Promise<request.Response> {
  const { token } = await createSignedInUser();
  return request(app).post('/api/routes/plan').set('Authorization', bearer(token))
    .set('X-Forwarded-For', `198.51.100.${index}`).send(TRANSIT_PLAN);
}

// fakes Google answering every call with [status] after [delayMs], and records the most calls in flight at once
function slowGoogle(delayMs: number, status = 200): { fetch: jest.SpiedFunction<typeof fetch>; maxInFlight: () => number } {
  let inFlight = 0;
  let most = 0;
  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await wait(delayMs);
    inFlight -= 1;
    return new Response(JSON.stringify(googleAnswer(input)), { status });
  });
  return { fetch: spy, maxInFlight: () => most };
}

// Interface POST /api/routes/plan (decision 5: at most 20 Google calls at once)
describe('Mocked: POST /api/routes/plan Google calls', () => {
  // Mocked behavior: every Google call takes 300 ms
  // Input: 30 plans from 30 users, all sent at once
  // Expected status code: 200 for every plan (each waits well under 2 s for a slot)
  // Expected behavior: Google never sees more than 20 calls in flight
  // Expected output: planned results
  test('Never has more than 20 Google calls in flight', async () => {
    const google = slowGoogle(300);
    const app = createApp();

    const responses = await Promise.all(Array.from({ length: 30 }, (_, index) => planAsNewUser(app, index)));

    for (const response of responses) expect(response.status).toBe(200);
    expect(google.maxInFlight()).toBeLessThanOrEqual(20);
  });

  // Mocked behavior: every Google call takes 3 s, longer than the 2 s a call may wait for a slot
  // Input: 21 plans from 21 users, all sent at once
  // Expected status code: 503 for the plan whose Google call found no slot, 200 for the other 20
  // Expected behavior: a call that can't get a slot within 2 s gives up instead of queueing forever
  // Expected output: { error: "Couldn't reach the route service" }
  test("Returns 503 when a Google call can't get a slot within 2 s", async () => {
    slowGoogle(3000);
    const app = createApp();

    const responses = await Promise.all(Array.from({ length: 21 }, (_, index) => planAsNewUser(app, index)));

    const unavailable = responses.filter((response) => response.status === 503);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.body).toEqual({ error: "Couldn't reach the route service" });
    expect(responses.filter((response) => response.status === 200)).toHaveLength(20);
  });

  // Mocked behavior: Google answers 400, 403 and its own 429 (quota exceeded)
  // Input: one plan for each answer
  // Expected status code: 503
  // Expected behavior: a 4xx is never retried, so Google sees exactly one call
  // Expected output: { error: "Couldn't reach the route service" }
  test.each([400, 403, 429])('Does not retry a Google %i', async (status) => {
    const google = slowGoogle(0, status);

    const response = await planAsNewUser(createApp(), 0);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Couldn't reach the route service" });
    expect(google.fetch).toHaveBeenCalledTimes(1);
  });

  // Mocked behavior: Google answers 500, or the network fails
  // Input: one plan
  // Expected status code: 503
  // Expected behavior: retried once, so Google sees two calls at most
  // Expected output: { error: "Couldn't reach the route service" }
  test('Retries a Google 5xx once', async () => {
    const google = slowGoogle(0, 500);

    const response = await planAsNewUser(createApp(), 0);

    expect(response.status).toBe(503);
    expect(google.fetch).toHaveBeenCalledTimes(2);
  });

  test('Retries a network failure once', async () => {
    const google = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const response = await planAsNewUser(createApp(), 0);

    expect(response.status).toBe(503);
    expect(google).toHaveBeenCalledTimes(2);
  });
});
