import request from 'supertest';

import { createApp } from '../../src/app';
import { DEMO_TRIPS } from '../../src/data/demo-trips';
import { TripModel, type Leg } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { createTrip } from '../helpers/trips';

useTestDatabase();

interface TripBody {
  id: string;
  legs: Leg[];
  totalDurationSeconds: number;
  totalCostCents: number;
  tripDate: string;
}

const seed = (token: string) =>
  request(createApp()).post('/api/users/me/trips/seed').set('Authorization', bearer(token));

// Interface POST /api/users/me/trips/seed
describe('Unmocked: POST /api/users/me/trips/seed', () => {
  // Input: Authorization header with a valid session token, for a user with no trips
  // Expected status code: 200
  // Expected behavior: the demo trips are saved for the user, marked as seeded
  // Expected output: { trips } with every demo trip, newest first, dated in the past, totals equal to the sum of the legs
  test('Adds the demo trips', async () => {
    const { user, token } = await createSignedInUser();

    const response = await seed(token);

    expect(response.status).toBe(200);
    const trips = (response.body as { trips: TripBody[] }).trips;
    expect(trips).toHaveLength(DEMO_TRIPS.length);
    const dates = trips.map((trip) => Date.parse(trip.tripDate));
    expect(dates).toStrictEqual([...dates].sort((a, b) => b - a));
    for (const trip of trips) {
      expect(Date.parse(trip.tripDate)).toBeLessThan(Date.now());
      expect(trip.totalDurationSeconds).toBe(trip.legs.reduce((sum, leg) => sum + leg.durationSeconds, 0));
      expect(trip.totalCostCents).toBe(trip.legs.reduce((sum, leg) => sum + leg.costCents, 0));
    }
    expect(await TripModel.countDocuments({ userId: user._id, seeded: true })).toBe(DEMO_TRIPS.length);
  });

  // Input: Authorization header with a valid session token, sent twice
  // Expected status code: 200
  // Expected behavior: the second request replaces the first set instead of adding to it
  // Expected output: { trips } with one set of demo trips
  test('Seeding again replaces the demo trips', async () => {
    const { user, token } = await createSignedInUser();
    await seed(token);

    const response = await seed(token);

    expect(response.status).toBe(200);
    expect((response.body as { trips: TripBody[] }).trips).toHaveLength(DEMO_TRIPS.length);
    expect(await TripModel.countDocuments({ userId: user._id })).toBe(DEMO_TRIPS.length);
  });

  // Input: Authorization header with a valid session token, for a user with a saved trip, plus another user's trip
  // Expected status code: 200
  // Expected behavior: the user's saved trip is kept, and the other user's trips are untouched
  // Expected output: { trips } with the demo trips and the saved trip
  test('Keeps real trips and other users\' trips', async () => {
    const { user, token } = await createSignedInUser();
    const { user: other } = await createSignedInUser();
    const real = await createTrip(user._id);
    await createTrip(other._id);

    const response = await seed(token);

    expect(response.status).toBe(200);
    const ids = (response.body as { trips: TripBody[] }).trips.map((trip) => trip.id);
    expect(ids).toHaveLength(DEMO_TRIPS.length + 1);
    expect(ids).toContain(real._id.toString());
    expect(await TripModel.countDocuments({ userId: other._id })).toBe(1);
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected before any trips are written
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).post('/api/users/me/trips/seed');

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
    expect(await TripModel.countDocuments()).toBe(0);
  });
});
