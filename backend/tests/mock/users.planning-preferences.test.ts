import request from 'supertest';

import { createApp } from '../../src/app';
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

// Interface PUT /api/users/me/planning-preferences
describe('Mocked: PUT /api/users/me/planning-preferences', () => {
  // Mocked behavior: the preference update fails in the database
  // Input: valid session and valid preferences
  // Expected status code: 500
  // Expected behavior: error middleware handles the database failure
  // Expected output: { error: "Internal Server Error" }
  test('Handles a database error', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findByIdAndUpdate').mockReturnValueOnce(failingQuery());

    const response = await request(createApp())
      .put('/api/users/me/planning-preferences')
      .set('Authorization', bearer(token))
      .send({ costVsTime: 75, defaultModes: ['DRIVE'] });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
  });

  // Mocked behavior: the account is deleted after session validation but before preferences are saved
  // Input: valid session and valid preferences
  // Expected status code: 401
  // Expected behavior: do not return a stale account
  // Expected output: { error: "Unauthorized" }
  test('Handles an account deleted during the update', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findByIdAndUpdate').mockReturnValueOnce({ lean: () => Promise.resolve(null) } as never);

    const response = await request(createApp())
      .put('/api/users/me/planning-preferences')
      .set('Authorization', bearer(token))
      .send({ costVsTime: 75, defaultModes: ['DRIVE'] });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});