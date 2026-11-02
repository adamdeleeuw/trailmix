import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { createTrip } from '../helpers/trips';

useTestDatabase();

const PATH = '/api/users/me/trips';
const UNKNOWN_ID = '0123456789abcdef01234567';

// Interface DELETE /api/users/me/trips/:id
describe('Unmocked: DELETE /api/users/me/trips/:id', () => {
  // Input: a valid session and the user's PLANNED trip
  // Expected status code: 204
  // Expected behavior: the trip is deleted, and the user's other trips are kept
  // Expected output: empty body
  test('PLANNED trip is deleted', async () => {
    const { user, token } = await createSignedInUser();
    const planned = await createTrip(user._id, { status: 'PLANNED' });
    const kept = await createTrip(user._id);

    const response = await request(createApp()).delete(`${PATH}/${planned._id.toString()}`)
      .set('Authorization', bearer(token));

    expect(response.status).toBe(204);
    expect(response.body).toStrictEqual({});
    expect(await TripModel.exists({ _id: planned._id })).toBeNull();
    expect(await TripModel.exists({ _id: kept._id })).not.toBeNull();
  });

  // Input: a valid session, and the user's COMPLETED trip, then their ACTIVE trip
  // Expected status code: 409
  // Expected behavior: only planned trips can be deleted, so both are kept
  // Expected output: { error: "Not allowed in the trip's current status" }
  test('COMPLETED and ACTIVE trips are not deleted', async () => {
    const { user, token } = await createSignedInUser();
    const completed = await createTrip(user._id, { status: 'COMPLETED' });
    const active = await createTrip(user._id, { status: 'ACTIVE', actualStart: new Date() });

    for (const trip of [completed, active]) {
      const response = await request(createApp()).delete(`${PATH}/${trip._id.toString()}`)
        .set('Authorization', bearer(token));

      expect(response.status).toBe(409);
      expect(response.body).toStrictEqual({ error: "Not allowed in the trip's current status" });
    }
    expect(await TripModel.countDocuments({ userId: user._id })).toBe(2);
  });

  // Input: a valid session, and an id no trip has, then an id that isn't a MongoDB ID
  // Expected status code: 404
  // Expected behavior: nothing is deleted
  // Expected output: { error: "Trip not found" }
  test('Unknown id is rejected', async () => {
    const { token } = await createSignedInUser();

    for (const id of [UNKNOWN_ID, '123']) {
      const response = await request(createApp()).delete(`${PATH}/${id}`).set('Authorization', bearer(token));

      expect(response.status).toBe(404);
      expect(response.body).toStrictEqual({ error: 'Trip not found' });
    }
  });

  // Input: a valid session, and another user's PLANNED trip
  // Expected status code: 404
  // Expected behavior: another user's trip is treated as missing, and it is kept
  // Expected output: { error: "Trip not found" }
  test("Someone else's trip is rejected", async () => {
    const { user: other } = await createSignedInUser();
    const { token } = await createSignedInUser();
    const trip = await createTrip(other._id, { status: 'PLANNED' });

    const response = await request(createApp()).delete(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token));

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Trip not found' });
    expect(await TripModel.exists({ _id: trip._id })).not.toBeNull();
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected, and the trip is kept
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const { user } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'PLANNED' });

    const response = await request(createApp()).delete(`${PATH}/${trip._id.toString()}`);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
    expect(await TripModel.exists({ _id: trip._id })).not.toBeNull();
  });
});
