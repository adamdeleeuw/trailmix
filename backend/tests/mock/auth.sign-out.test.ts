import request from 'supertest';

import { createApp } from '../../src/app';
import { SessionModel } from '../../src/models/session.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface POST /api/auth/sign-out
describe('Mocked: POST /api/auth/sign-out', () => {
  // Mocked behavior: deleting the session fails
  // Input: Authorization header with a valid session token
  // Expected status code: 500
  // Expected behavior: error is handled without crashing and the session still exists
  // Expected output: { error: "Internal Server Error" }
  test('Database error while deleting the session', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(SessionModel, 'deleteOne').mockRejectedValueOnce(new Error('Simulated database error'));

    const response = await request(createApp()).post('/api/auth/sign-out').set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
    expect(await SessionModel.countDocuments()).toBe(1);
  });
});
