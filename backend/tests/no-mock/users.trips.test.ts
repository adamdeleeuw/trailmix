import request from 'supertest';
import type { Types } from 'mongoose';

import { createApp } from '../../src/app';
import { TripModel, type Trip } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

const tripData = (userId: Types.ObjectId, tripDate: Date, origin: string): Omit<Trip, '_id' | 'createdAt' | 'updatedAt'> => ({
  userId,
  origin: { label: origin, lat: 49.2, lng: -123.1, placeId: null },
  midpoint: null,
  destination: { label: 'Work', lat: 49.28, lng: -123.12, placeId: null },
  legs: [{
    mode: 'DRIVE',
    from: { label: origin, lat: 49.2, lng: -123.1, placeId: null },
    to: { label: 'Work', lat: 49.28, lng: -123.12, placeId: null },
    durationSeconds: 600,
    distanceMeters: 5000,
    costCents: 125,
    polyline: 'encoded-route',
    transitLines: [],
  }],
  totalDurationSeconds: 600,
  totalCostCents: 125,
  tripDate,
  seeded: false,
});

describe('GET /api/users/me/trips', () => {
  test('returns only the signed-in user trips, newest first', async () => {
    const { user, token } = await createSignedInUser();
    const otherUser = await createSignedInUser();
    const olderDate = new Date('2026-01-01T08:00:00.000Z');
    const newerDate = new Date('2026-01-03T08:00:00.000Z');
    await TripModel.insertMany([
      tripData(user._id, olderDate, 'Home'),
      tripData(user._id, newerDate, 'Office'),
      tripData(otherUser.user._id, newerDate, 'Other home'),
    ]);

    const response = await request(createApp())
      .get('/api/users/me/trips')
      .set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.trips).toHaveLength(2);
    expect(response.body.trips.map((trip: { origin: { label: string } }) => trip.origin.label))
      .toEqual(['Office', 'Home']);
    expect(response.body.trips[0]).not.toHaveProperty('userId');
    expect(response.body.trips[0]).not.toHaveProperty('seeded');
  });

  test('requires a valid session', async () => {
    const response = await request(createApp()).get('/api/users/me/trips');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});