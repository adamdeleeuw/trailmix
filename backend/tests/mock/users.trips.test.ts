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

// Interface GET /api/users/me/trips
describe('Mocked: GET /api/users/me/trips', () => {
  // Mocked behavior: reading the trips fails
  // Input: Authorization header with a valid session token
  // Expected status code: 500
  // Expected behavior: error is handled without crashing
  // Expected output: { error: "Internal Server Error" }
  test('Database error while reading trips', async () => {
    const { user, token } = await createSignedInUser();
    const find = jest.spyOn(TripModel, 'find').mockImplementationOnce(() => {
      throw new Error('Simulated database error');
    });

    const response = await request(createApp())
      .get('/api/users/me/trips')
      .set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(find).toHaveBeenCalledWith({ userId: user._id });
  });
});
