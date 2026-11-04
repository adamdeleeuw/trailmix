import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
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
  // Expected output: { trips } with both trips' public fields, without userId, seeded, midpoint, or timestamps
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
        status: 'COMPLETED',
        origin: trip.origin,
        destination: trip.destination,
        transferPoints: [],
        legs: trip.legs,
        totalDurationSeconds: trip.totalDurationSeconds,
        totalDistanceMeters: trip.totalDistanceMeters,
        totalCostCents: trip.totalCostCents,
        costBreakdown: trip.costBreakdown,
        costEstimated: false,
        baselineDriveCostCents: null,
        arriveBy: null,
        plannedStart: null,
        plannedEnd: null,
        actualStart: null,
        actualEnd: null,
        tripDate: trip.tripDate.toISOString(),
      })),
    });
  });

  // Input: Authorization header with a valid session token, for a user with a trip stored before CP2
  //        (one midpoint, no status, cost breakdown, distance or leg times)
  // Expected status code: 200
  // Expected behavior: the old trip loads with the CP2 defaults instead of failing
  // Expected output: { trips } with status COMPLETED, transferPoints [midpoint], the summed leg distance,
  //                  an empty cost breakdown, null leg times and transit details, and no turn-by-turn steps
  test('Trip saved before CP2 loads with defaults', async () => {
    const { user, token } = await createSignedInUser();
    const home = { label: 'Home', lat: 49.19, lng: -122.85, placeId: null };
    const station = { label: 'Surrey Central', lat: 49.19, lng: -122.85, placeId: null };
    const ubc = { label: 'UBC', lat: 49.26, lng: -123.25, placeId: null };
    const tripDate = new Date('2026-01-02T08:15:00.000Z');
    const { insertedId } = await TripModel.collection.insertOne({
      userId: user._id,
      origin: home,
      midpoint: station,
      destination: ubc,
      legs: [
        { mode: 'DRIVE', from: home, to: station, durationSeconds: 660, distanceMeters: 4200, costCents: 64, polyline: 'drive', transitLines: [] },
        {
          mode: 'TRANSIT', from: station, to: ubc, durationSeconds: 3300, distanceMeters: 31000, costCents: 335, polyline: 'transit',
          transitLines: [{ name: '99 B-Line', vehicle: 'Bus' }],
        },
      ],
      totalDurationSeconds: 3960,
      totalCostCents: 399,
      tripDate,
      seeded: true,
    });

    const response = await request(createApp())
      .get('/api/users/me/trips')
      .set('Authorization', bearer(token));

    const oldLegDefaults = { departAt: null, arriveAt: null, steps: [] };
    const noDetails = { shortName: null, colour: null, headsign: null, departureStop: null, arrivalStop: null, stopCount: null };
    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      trips: [{
        id: insertedId.toString(),
        status: 'COMPLETED',
        origin: home,
        destination: ubc,
        transferPoints: [station],
        legs: [
          { mode: 'DRIVE', from: home, to: station, ...oldLegDefaults, durationSeconds: 660, distanceMeters: 4200, costCents: 64, polyline: 'drive', transitLines: [] },
          {
            mode: 'TRANSIT', from: station, to: ubc, ...oldLegDefaults, durationSeconds: 3300, distanceMeters: 31000, costCents: 335, polyline: 'transit',
            transitLines: [{ name: '99 B-Line', vehicle: 'Bus', ...noDetails }],
          },
        ],
        totalDurationSeconds: 3960,
        totalDistanceMeters: 35200,
        totalCostCents: 399,
        costBreakdown: { fuelCents: 0, parkingCents: 0, fareCents: 0 },
        costEstimated: false,
        baselineDriveCostCents: null,
        arriveBy: null,
        plannedStart: null,
        plannedEnd: null,
        actualStart: null,
        actualEnd: null,
        tripDate: tripDate.toISOString(),
      }],
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
