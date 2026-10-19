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

// Interface PUT /api/users/me/gas-price
describe('Mocked: PUT /api/users/me/gas-price', () => {
  // Mocked behavior: saving the gas price fails
  // Input: a valid session and { centsPerLitre: 189.9 }
  // Expected status code: 500
  // Expected behavior: error is handled without crashing
  // Expected output: { error: "Internal Server Error" }
  test('Database error while saving', async () => {
    const { token } = await createSignedInUser();
    const save = jest.spyOn(UserModel, 'findByIdAndUpdate').mockReturnValueOnce(failingQuery());

    const response = await request(createApp())
      .put('/api/users/me/gas-price')
      .set('Authorization', bearer(token))
      .send({ centsPerLitre: 189.9 });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  // Mocked behavior: the account is deleted between the session check and the save
  // Input: a valid session and { centsPerLitre: 189.9 }
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('Account deleted while saving', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findByIdAndUpdate').mockReturnValueOnce({ lean: () => Promise.resolve(null) } as never);

    const response = await request(createApp())
      .put('/api/users/me/gas-price')
      .set('Authorization', bearer(token))
      .send({ centsPerLitre: 189.9 });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
  });
});
