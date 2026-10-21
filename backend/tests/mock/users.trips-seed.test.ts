import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface POST /api/users/me/trips/seed
describe('Mocked: POST /api/users/me/trips/seed', () => {
  // Mocked behavior: saving the demo trips fails
  // Input: Authorization header with a valid session token
  // Expected status code: 500
  // Expected behavior: error is handled without crashing
  // Expected output: { error: "Internal Server Error" }
  test('Database error while saving demo trips', async () => {
    const { token } = await createSignedInUser();
    const insertMany = jest.spyOn(TripModel, 'insertMany').mockImplementationOnce(() => {
      throw new Error('Simulated database error');
    });

    const response = await request(createApp())
      .post('/api/users/me/trips/seed')
      .set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(insertMany).toHaveBeenCalledTimes(1);
  });
});
