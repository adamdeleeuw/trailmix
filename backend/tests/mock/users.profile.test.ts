import request from 'supertest';

import { createApp } from '../../src/app';
import { UserModel } from '../../src/models/user.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { failingQuery, useTestDatabase } from '../helpers/db';

useTestDatabase();

const profile = { timezone: 'America/Vancouver', vehicle: null, transit: null };

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface PUT /api/users/me/profile
describe('Mocked: PUT /api/users/me/profile', () => {
  // Mocked behavior: saving the profile fails
  // Input: a valid session and a valid profile
  // Expected status code: 500
  // Expected behavior: error is handled without crashing
  // Expected output: { error: "Internal Server Error" }
  test('Database error while saving', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findByIdAndUpdate').mockReturnValueOnce(failingQuery());

    const response = await request(createApp())
      .put('/api/users/me/profile')
      .set('Authorization', bearer(token))
      .send(profile);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
  });

  // Mocked behavior: the account is deleted between the session check and the save
  // Input: a valid session and a valid profile
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('Account deleted while saving', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findByIdAndUpdate').mockReturnValueOnce({ lean: () => Promise.resolve(null) } as never);

    const response = await request(createApp())
      .put('/api/users/me/profile')
      .set('Authorization', bearer(token))
      .send(profile);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});
