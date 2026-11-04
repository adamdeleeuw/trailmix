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

  // Input: valid session and a max walk of 15 minutes, then a save that leaves the max walk out
  // Expected status code: 200 for both
  // Expected behavior: the max walk is saved, and a later save without it keeps it
  // Expected output: { user } with maxWalkMinutes 15 both times
  test('Saves the max walk and keeps it when a save leaves it out', async () => {
    const { token } = await createSignedInUser();
    const put = (body: object) => request(createApp())
      .put('/api/users/me/planning-preferences')
      .set('Authorization', bearer(token))
      .send(body);

    const saved = await put({ ...PREFERENCES, maxWalkMinutes: 15 });
    const kept = await put({ ...PREFERENCES, costVsTime: 20 });

    expect(saved.status).toBe(200);
    expect(saved.body.user.maxWalkMinutes).toBe(15);
    expect(kept.status).toBe(200);
    expect(kept.body.user).toMatchObject({ costVsTime: 20, maxWalkMinutes: 15 });
  });

  // Input: invalid cost value, unknown default mode, or a max walk outside 1 to 60 whole minutes
  // Expected status code: 400
  // Expected behavior: reject without saving
  // Expected output: an error naming the planning preferences
  test('Rejects out-of-range values and unknown modes', async () => {
    const { token } = await createSignedInUser();
    const bodies = [
      { ...PREFERENCES, costVsTime: 101 },
      { ...PREFERENCES, defaultModes: ['BIKE'] },
      { ...PREFERENCES, maxWalkMinutes: 61 },
      { ...PREFERENCES, maxWalkMinutes: '10' },
    ];

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