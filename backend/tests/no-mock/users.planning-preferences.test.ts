import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

const PREFERENCES = { costVsTime: 75, defaultModes: ['DRIVE', 'TRANSIT'] };

// Interface PUT /api/users/me/planning-preferences
describe('Unmocked: PUT /api/users/me/planning-preferences', () => {
  // Input: valid session and values inside the allowed ranges
  // Expected status code: 200
  // Expected behavior: preferences are persisted and returned as part of the account
  // Expected output: { user } with costVsTime 75 and default modes Drive and Transit
  test('Saves valid preferences', async () => {
    const { token } = await createSignedInUser();

    const response = await request(createApp())
      .put('/api/users/me/planning-preferences')
      .set('Authorization', bearer(token))
      .send(PREFERENCES);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject(PREFERENCES);
  });

  // Input: invalid cost value or unknown default mode
  // Expected status code: 400
  // Expected behavior: reject without saving
  // Expected output: an error naming the planning preferences
  test('Rejects out-of-range values and unknown modes', async () => {
    const { token } = await createSignedInUser();
    const bodies = [{ ...PREFERENCES, costVsTime: 101 }, { ...PREFERENCES, defaultModes: ['BIKE'] }];

    for (const body of bodies) {
      const response = await request(createApp())
        .put('/api/users/me/planning-preferences')
        .set('Authorization', bearer(token))
        .send(body);
      expect(response.status).toBe(400);
    }
  });

  // Input: valid preferences without a session
  // Expected status code: 401
  // Expected behavior: reject before saving
  // Expected output: { error: "Unauthorized" }
  test('Rejects a missing session', async () => {
    const response = await request(createApp()).put('/api/users/me/planning-preferences').send(PREFERENCES);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});