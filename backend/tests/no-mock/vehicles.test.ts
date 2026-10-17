import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

/** Sorts a copy of the names the same way the API should. */
const sorted = (names: string[]): string[] =>
  [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

// Interface GET /api/vehicles/makes
describe('Unmocked: GET /api/vehicles/makes', () => {
  // Input: Authorization header with a valid session token
  // Expected status code: 200
  // Expected behavior: every make in the vehicle list is returned
  // Expected output: { makes: string[] } sorted alphabetically
  test('Makes are sorted alphabetically', async () => {
    const { token } = await createSignedInUser();

    const response = await request(createApp()).get('/api/vehicles/makes').set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    const { makes } = response.body as { makes: string[] };
    expect(makes).toContain('Toyota');
    expect(makes).toEqual(sorted(makes));
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).get('/api/vehicles/makes');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});

// Interface GET /api/vehicles/makes/:make/models
describe('Unmocked: GET /api/vehicles/makes/:make/models', () => {
  // Input: a valid session and a make in the list, including one that needs URL encoding
  // Expected status code: 200
  // Expected behavior: that make's base models are returned
  // Expected output: { models: string[] } sorted alphabetically
  test('Known make', async () => {
    const { token } = await createSignedInUser();
    const app = createApp();

    const toyota = await request(app).get('/api/vehicles/makes/Toyota/models').set('Authorization', bearer(token));
    const mercedes = await request(app)
      .get(`/api/vehicles/makes/${encodeURIComponent('Mercedes-Benz')}/models`)
      .set('Authorization', bearer(token));

    expect(toyota.status).toBe(200);
    const { models } = toyota.body as { models: string[] };
    expect(models).toContain('Corolla');
    expect(models).toEqual(sorted(models));
    expect(mercedes.status).toBe(200);
    expect(mercedes.body).toEqual({ models: expect.arrayContaining(['C-Class']) as unknown });
  });

  // Input: a valid session and makes that aren't in the list (wrong case, or unknown)
  // Expected status code: 404
  // Expected behavior: request is rejected
  // Expected output: { error: "Unknown make" }
  test('Unknown make', async () => {
    const { token } = await createSignedInUser();
    const app = createApp();

    for (const make of ['toyota', 'Tesla', 'constructor']) {
      const response = await request(app).get(`/api/vehicles/makes/${make}/models`).set('Authorization', bearer(token));

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Unknown make' });
    }
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).get('/api/vehicles/makes/Toyota/models');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});
