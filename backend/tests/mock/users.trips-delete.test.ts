import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { createTrip } from '../helpers/trips';

useTestDatabase();

const PATH = '/api/users/me/trips';

/** Makes the next call to a trip query method throw, the way a lost database connection would. */
function failNext(method: 'deleteOne' | 'findOne'): jest.SpyInstance {
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

// Interface DELETE /api/users/me/trips/:id
describe('Mocked: DELETE /api/users/me/trips/:id', () => {
  // Mocked behavior: deleting the trip fails with a database error
  // Input: a valid session and the user's PLANNED trip
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and the trip is kept
  // Expected output: { error: "Internal Server Error" }
  test('Database error while deleting', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'PLANNED' });
    const remove = failNext('deleteOne');

    const response = await request(createApp()).delete(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await TripModel.exists({ _id: trip._id })).not.toBeNull();
  });

  // Mocked behavior: reading the trip's status, to explain why nothing was deleted, fails
  // Input: a valid session and the user's COMPLETED trip
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and the trip is kept
  // Expected output: { error: "Internal Server Error" }
  test('Database error while explaining a rejected delete', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createTrip(user._id, { status: 'COMPLETED' });
    const lookup = failNext('findOne');

    const response = await request(createApp()).delete(`${PATH}/${trip._id.toString()}`)
      .set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await TripModel.exists({ _id: trip._id })).not.toBeNull();
  });
});
