import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel, type Trip } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { createTrip } from '../helpers/trips';

useTestDatabase();

const PATH = '/api/users/me/trips';
const UNKNOWN_ID = '0123456789abcdef01234567';
const STARTED_AT = new Date('2026-01-15T15:31:00.000Z'); // in the past, so ending it "now" or at ENDED_AT is never in the future
const ENDED_AT = '2026-01-15T16:21:00.000Z';

/** Reads a trip's status and actual times straight from the database. */
async function storedTimes(trip: Trip) {
  return TripModel.findById(trip._id, { status: 1, actualStart: 1, actualEnd: 1, tripDate: 1 }).lean();
}

// Interface PATCH /api/users/me/trips/:id
describe('Unmocked: PATCH /api/users/me/trips/:id', () => {
  // Input: a valid session, the user's PLANNED trip, and { status: "ACTIVE", actualStart } from the app
  // Expected status code: 200
  // Expected behavior: the trip starts at the app's time, and History dates it by when it started
  // Expected output: { trip } with status ACTIVE, and actualStart and tripDate set to the app's time
  test('PLANNED → ACTIVE sets actualStart', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'PLANNED' });
    const actualStart = new Date().toISOString();

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'ACTIVE', actualStart });

    expect(response.status).toBe(200);
    expect(response.body.trip).toMatchObject({
      id: trip._id.toString(), status: 'ACTIVE', actualStart, actualEnd: null, tripDate: actualStart,
    });
  });

  // Input: a valid session, the user's ACTIVE trip, and { status: "COMPLETED", actualEnd } from the app
  // Expected status code: 200
  // Expected behavior: the trip ends at the app's time, so it counts in History's totals
  // Expected output: { trip } with status COMPLETED, the original actualStart, and actualEnd set
  test('ACTIVE → COMPLETED sets actualEnd', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'ACTIVE', actualStart: STARTED_AT });

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'COMPLETED', actualEnd: ENDED_AT });

    expect(response.status).toBe(200);
    expect(response.body.trip).toMatchObject({
      status: 'COMPLETED', actualStart: STARTED_AT.toISOString(), actualEnd: ENDED_AT,
    });
  });

  // Input: a valid session, the user's ACTIVE trip, and { status: "CANCELLED" } with no time
  // Expected status code: 200
  // Expected behavior: the trip ends now, and is kept for the record
  // Expected output: { trip } with status CANCELLED and actualEnd set to the server's current time
  test('ACTIVE → CANCELLED ends it now', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'ACTIVE', actualStart: STARTED_AT });
    const before = Date.now();

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'CANCELLED' });

    expect(response.status).toBe(200);
    expect(response.body.trip.status).toBe('CANCELLED');
    const endedAt = Date.parse(String(response.body.trip.actualEnd));
    expect(endedAt).toBeGreaterThanOrEqual(before);
    expect(endedAt).toBeLessThanOrEqual(Date.now());
  });

  // Input: a valid session, the user's COMPLETED trip, and each of ACTIVE, COMPLETED and CANCELLED
  // Expected status code: 409
  // Expected behavior: a finished trip can't change, so it stays COMPLETED
  // Expected output: { error: "Not allowed in the trip's current status" }
  test('COMPLETED → anything is rejected', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'COMPLETED', actualStart: STARTED_AT, actualEnd: new Date(ENDED_AT) });

    for (const status of ['ACTIVE', 'COMPLETED', 'CANCELLED']) {
      const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
        .set('Authorization', bearer(token)).send({ status });

      expect(response.status).toBe(409);
      expect(response.body).toStrictEqual({ error: "Not allowed in the trip's current status" });
    }
    expect((await storedTimes(trip))?.status).toBe('COMPLETED');
  });

  // Input: a valid session, the user's PLANNED trip, and { status: "COMPLETED" }
  // Expected status code: 409
  // Expected behavior: a trip must start before it can end, so it stays PLANNED
  // Expected output: { error: "Not allowed in the trip's current status" }
  test('PLANNED → COMPLETED is rejected', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'PLANNED' });

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'COMPLETED' });

    expect(response.status).toBe(409);
    expect((await storedTimes(trip))?.status).toBe('PLANNED');
  });

  // Input: a valid session, the user's ACTIVE trip started at 15:31, and an actualEnd of 15:00
  // Expected status code: 400
  // Expected behavior: a trip can't end before it started, so it stays ACTIVE with no end time
  // Expected output: { error: "Invalid trip" }
  test('actualEnd before actualStart is rejected', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'ACTIVE', actualStart: STARTED_AT });

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'COMPLETED', actualEnd: '2026-01-15T15:00:00.000Z' });

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid trip' });
    expect(await storedTimes(trip)).toMatchObject({ status: 'ACTIVE', actualEnd: null });
  });

  // Input: a valid session for a user with an ACTIVE trip, and { status: "ACTIVE" } on their PLANNED trip
  // Expected status code: 409
  // Expected behavior: only one trip can be ACTIVE, so the planned trip stays PLANNED
  // Expected output: { error: "Another trip is already active" }
  test('Starting a planned trip while another is ACTIVE is rejected', async () => {
    const { user, token } = await createSignedInUser();
    await createTrip(user._id, { status: 'ACTIVE', actualStart: STARTED_AT });
    const planned = await createTrip(user._id, { status: 'PLANNED' });

    const response = await request(createApp()).patch(`${PATH}/${planned._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'ACTIVE' });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'Another trip is already active' });
    expect((await storedTimes(planned))?.status).toBe('PLANNED');
  });

  // Input: a valid session, the user's ACTIVE trip, and status PLANNED, an actualEnd that isn't a date,
  //        and a body that is a list
  // Expected status code: 400
  // Expected behavior: a trip can't move back to PLANNED, times must be ISO 8601, and nothing changes
  // Expected output: { error: "Invalid status change" }
  test('Invalid status change is rejected', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'ACTIVE', actualStart: STARTED_AT });

    for (const body of [{ status: 'PLANNED' }, { status: 'COMPLETED', actualEnd: 'yesterday' }, ['COMPLETED']]) {
      const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
        .set('Authorization', bearer(token)).send(body);

      expect(response.status).toBe(400);
      expect(response.body).toStrictEqual({ error: 'Invalid status change' });
    }
    expect((await storedTimes(trip))?.status).toBe('ACTIVE');
  });

  // Input: a valid session, and an id no trip has, then an id that isn't a MongoDB ID
  // Expected status code: 404
  // Expected behavior: nothing changes
  // Expected output: { error: "Trip not found" }
  test('Unknown id is rejected', async () => {
    const { token } = await createSignedInUser();

    for (const id of [UNKNOWN_ID, 'not-an-id']) {
      const response = await request(createApp()).patch(`${PATH}/${id}`)
        .set('Authorization', bearer(token)).send({ status: 'COMPLETED' });

      expect(response.status).toBe(404);
      expect(response.body).toStrictEqual({ error: 'Trip not found' });
    }
  });

  // Input: a valid session, and { status: "COMPLETED" } on another user's ACTIVE trip
  // Expected status code: 404
  // Expected behavior: another user's trip is treated as missing, and it stays ACTIVE
  // Expected output: { error: "Trip not found" }
  test("Someone else's trip is rejected", async () => {
    const { user: other } = await createSignedInUser();
    const { token } = await createSignedInUser();
    const trip = await createTrip(other._id, { status: 'ACTIVE', actualStart: STARTED_AT });

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'COMPLETED' });

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Trip not found' });
    expect(await storedTimes(trip)).toMatchObject({ status: 'ACTIVE', actualEnd: null });
  });

  // Input: a trip saved before CP2 (no stored status), and { status: "ACTIVE" }
  // Expected status code: 409
  // Expected behavior: an old trip counts as COMPLETED, so it can't start again
  // Expected output: { error: "Not allowed in the trip's current status" }
  test('Trip saved before CP2 counts as COMPLETED', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id);
    await TripModel.collection.updateOne({ _id: trip._id }, { $unset: { status: '' } });

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'ACTIVE' });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: "Not allowed in the trip's current status" });
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected, and the trip stays ACTIVE
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const { user } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'ACTIVE', actualStart: STARTED_AT });

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`).send({ status: 'COMPLETED' });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
    expect((await storedTimes(trip))?.status).toBe('ACTIVE');
  });
});
