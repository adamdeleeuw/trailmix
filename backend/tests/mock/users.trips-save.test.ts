import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { tripBody } from '../helpers/trips';

useTestDatabase();

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface POST /api/users/me/trips
describe('Mocked: POST /api/users/me/trips', () => {
  // Mocked behavior: saving the trip fails with a database error
  // Input: a valid session and a valid PLANNED trip
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and nothing is saved
  // Expected output: { error: "Internal Server Error" }
  test('Database error while saving', async () => {
    const { token } = await createSignedInUser();
    const create = jest.spyOn(TripModel, 'create').mockRejectedValueOnce(new Error('Simulated database error'));

    const response = await request(createApp()).post('/api/users/me/trips')
      .set('Authorization', bearer(token)).send(tripBody());

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(await TripModel.countDocuments()).toBe(0);
  });
});
