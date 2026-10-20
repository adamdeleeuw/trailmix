import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { createTrip } from '../helpers/trips';

useTestDatabase();

const OFFICE = { label: 'Office', lat: 49.26, lng: -123.25, placeId: 'office-place-id' };

// Interface GET /api/users/me/trips
describe('Unmocked: GET /api/users/me/trips', () => {
  // Input: Authorization header with a valid session token, for a user with two trips, plus another user's trip
  // Expected status code: 200
  // Expected behavior: only the signed-in user's trips are returned, newest first
  // Expected output: { trips } with both trips' public fields, without userId, seeded, or timestamps
  test('Returns only my trips, newest first', async () => {
    const { user, token } = await createSignedInUser();
    const { user: other } = await createSignedInUser();
    const older = await createTrip(user._id, { tripDate: new Date('2026-01-01T08:00:00.000Z') });
    const newer = await createTrip(user._id, { origin: OFFICE, tripDate: new Date('2026-01-03T08:00:00.000Z') });
    await createTrip(other._id, { tripDate: new Date('2026-01-03T08:00:00.000Z') });

    const response = await request(createApp())
      .get('/api/users/me/trips')
      .set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      trips: [newer, older].map((trip) => ({
        id: trip._id.toString(),
        origin: trip.origin,
        midpoint: null,
        destination: trip.destination,
        legs: trip.legs,
        totalDurationSeconds: trip.totalDurationSeconds,
        totalCostCents: trip.totalCostCents,
        tripDate: trip.tripDate.toISOString(),
      })),
    });
  });

  // Input: Authorization header with a valid session token, for a user with no trips
  // Expected status code: 200
  // Expected behavior: an empty history is returned, not an error
  // Expected output: { trips: [] }
  test('No trips yet', async () => {
    const { token } = await createSignedInUser();

    const response = await request(createApp())
      .get('/api/users/me/trips')
      .set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ trips: [] });
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected before any trips are read
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).get('/api/users/me/trips');

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
  });
});
