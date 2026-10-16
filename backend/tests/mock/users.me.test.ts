import request from 'supertest';

import { createApp } from '../../src/app';
import { SessionModel } from '../../src/models/session.model';
import { UserModel } from '../../src/models/user.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { failingQuery, useTestDatabase } from '../helpers/db';

useTestDatabase();

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface GET /api/users/me
describe('Mocked: GET /api/users/me', () => {
  // Mocked behavior: the session lookup fails
  // Input: Authorization header with a valid session token
  // Expected status code: 500
  // Expected behavior: error is handled without crashing
  // Expected output: { error: "Internal Server Error" }
  test('Database error while finding the session', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(SessionModel, 'findOne').mockReturnValueOnce(failingQuery());

    const response = await request(createApp()).get('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
  });

  // Mocked behavior: the session is found but the user lookup fails
  // Input: Authorization header with a valid session token
  // Expected status code: 500
  // Expected behavior: error is handled without crashing
  // Expected output: { error: "Internal Server Error" }
  test('Database error while finding the user', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findById').mockReturnValueOnce(failingQuery());

    const response = await request(createApp()).get('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
  });
});
