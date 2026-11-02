import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { createTrip } from '../helpers/trips';

useTestDatabase();

const PATH = '/api/users/me/trips';

/** Makes the next call to a trip query method throw, the way a lost database connection would. */
function failNext(method: 'findOneAndUpdate' | 'findOne'): jest.SpyInstance {
  return jest.spyOn(TripModel, method).mockImplementationOnce(() => {
    throw new Error('Simulated database error');
  });
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface PATCH /api/users/me/trips/:id
describe('Mocked: PATCH /api/users/me/trips/:id', () => {
  // Mocked behavior: the status update fails with a database error
  // Input: a valid session, the user's ACTIVE trip, and { status: "COMPLETED" }
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and the trip stays ACTIVE
  // Expected output: { error: "Internal Server Error" }
  test('Database error while updating', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'ACTIVE', actualStart: new Date() });
    const update = failNext('findOneAndUpdate');

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'COMPLETED' });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(update).toHaveBeenCalledTimes(1);
    expect((await TripModel.findById(trip._id).lean())?.status).toBe('ACTIVE');
  });

  // Mocked behavior: reading the trip's status, to explain why the update matched nothing, fails
  // Input: a valid session, the user's COMPLETED trip, and { status: "CANCELLED" }
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and the trip stays COMPLETED
  // Expected output: { error: "Internal Server Error" }
  test('Database error while explaining a rejected update', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'COMPLETED' });
    const lookup = failNext('findOne');

    const response = await request(createApp()).patch(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token)).send({ status: 'CANCELLED' });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect((await TripModel.findById(trip._id).lean())?.status).toBe('COMPLETED');
  });
});
