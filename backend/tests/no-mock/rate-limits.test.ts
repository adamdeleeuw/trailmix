import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

jest.setTimeout(60_000);

function getMe(app: ReturnType<typeof createApp>, token: string, ip = '203.0.113.1'): request.Test {
  return request(app).get('/api/users/me').set('Authorization', bearer(token)).set('X-Forwarded-For', ip);
}

function expectGenericTooMany(response: request.Response): void {
  expect(response.status).toBe(429);
  expect(Object.keys(response.body as object)).toEqual(['error']);
  expect(typeof response.body.error).toBe('string');
  expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
}

// Interface every signed-in endpoint (decision 4: 60 requests a minute per user)
describe('Unmocked: signed-in request limit', () => {
  // Input: 60 GET /api/users/me from one user, one after another, then a 61st
  // Expected status code: 200 for the first 60, then 429
  // Expected behavior: the user's minute is used up
  // Expected output: { error } only, with Retry-After
  test("Refuses one user's 61st signed-in request in a minute", async () => {
    const app = createApp();
    const { token } = await createSignedInUser();
    for (let index = 0; index < 60; index += 1) {
      expect((await getMe(app, token)).status).toBe(200);
    }

    expectGenericTooMany(await getMe(app, token));
  });

  // Input: the fault report's reproduction, 100 concurrent GET /api/users/me from one signed-in user
  // Expected status code: exactly 60 200s and 40 429s
  // Expected behavior: a concurrent burst can't slip past the limit
  // Expected output: the user, or { error } with Retry-After
  test('Holds the limit against the reported burst of 100 concurrent requests', async () => {
    const app = createApp();
    const { token } = await createSignedInUser();

    const responses = await Promise.all(Array.from({ length: 100 }, () => getMe(app, token)));

    expect(responses.filter((response) => response.status === 200)).toHaveLength(60);
    const refused = responses.filter((response) => response.status === 429);
    expect(refused).toHaveLength(40);
    for (const response of refused) expectGenericTooMany(response);
  });
});

// Interface POST /api/auth/google (decision 4: 10 sign-ins a minute per IP address)
describe('Unmocked: sign-in limit', () => {
  // Input: 11 sign-in attempts from one address within a minute (empty tokens, so Google is never asked)
  // Expected status code: 400 for the first 10, then 429
  // Expected behavior: every attempt counts, whether or not it succeeds
  // Expected output: { error } only, with Retry-After
  test('Refuses the 11th sign-in from one address in a minute', async () => {
    const app = createApp();
    const signIn = (): request.Test =>
      request(app).post('/api/auth/google').set('X-Forwarded-For', '203.0.113.7').send({ idToken: '' });
    for (let index = 0; index < 10; index += 1) {
      expect((await signIn()).status).toBe(400);
    }

    expectGenericTooMany(await signIn());
  });
});

// Interface every /api endpoint (decision 4: 300 requests a minute per IP address)
describe('Unmocked: per-address limit', () => {
  // Input: 300 GET /api/users/me from six users on one address within a minute, then a 301st from a seventh user
  // Expected status code: 200 for the first 300, then 429
  // Expected behavior: one address is limited however many accounts it uses
  // Expected output: { error } only, with Retry-After
  test('Refuses the 301st /api request from one address in a minute', async () => {
    const app = createApp();
    for (let user = 0; user < 6; user += 1) {
      const { token } = await createSignedInUser();
      const responses = await Promise.all(Array.from({ length: 50 }, () => getMe(app, token)));
      expect(responses.every((response) => response.status === 200)).toBe(true);
    }
    const { token } = await createSignedInUser();

    expectGenericTooMany(await getMe(app, token));
  });

  // Input: an address uses up its 300 /api requests, then calls GET /health
  // Expected status code: 200
  // Expected behavior: the deploy health check is never limited
  // Expected output: { status: "ok" }
  test('Never limits /health', async () => {
    const app = createApp();
    const { token } = await createSignedInUser();
    const others = await Promise.all(Array.from({ length: 5 }, async () => (await createSignedInUser()).token));
    for (const userToken of [token, ...others]) {
      await Promise.all(Array.from({ length: 50 }, () => getMe(app, userToken)));
    }
    expect((await getMe(app, token)).status).toBe(429);

    const response = await request(app).get('/health').set('X-Forwarded-For', '203.0.113.1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
