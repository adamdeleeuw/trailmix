import request from 'supertest';

import { createApp } from '../../src/app';
import { UserModel } from '../../src/models/user.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

// Interface PUT /api/users/me/gas-price
describe('Unmocked: PUT /api/users/me/gas-price', () => {
  // Input: a valid session and { centsPerLitre: 189.9 }
  // Expected status code: 200
  // Expected behavior: the price is saved with the time the server received it
  // Expected output: { user } whose lastGasPrice is { centsPerLitre: 189.9, savedAt } with savedAt set to now
  test('Valid price is saved with the current time', async () => {
    const { user, token } = await createSignedInUser();
    const before = Date.now();

    const response = await request(createApp())
      .put('/api/users/me/gas-price')
      .set('Authorization', bearer(token))
      .send({ centsPerLitre: 189.9 });

    const after = Date.now();
    expect(response.status).toBe(200);
    expect(response.body.user.lastGasPrice.centsPerLitre).toBe(189.9);
    const savedAt = Date.parse(response.body.user.lastGasPrice.savedAt);
    expect(savedAt).toBeGreaterThanOrEqual(before);
    expect(savedAt).toBeLessThanOrEqual(after);
    const stored = await UserModel.findById(user._id).lean();
    expect(stored?.lastGasPrice).toStrictEqual({ centsPerLitre: 189.9, savedAt: new Date(savedAt) });
  });

  // Input: a valid session and the smallest and largest allowed prices, 50.0 and 400.0
  // Expected status code: 200
  // Expected behavior: both prices are accepted, and the second replaces the first
  // Expected output: { user } whose lastGasPrice.centsPerLitre is the price just sent
  test('Prices at the limits are accepted', async () => {
    const { token } = await createSignedInUser();
    const app = createApp();

    for (const centsPerLitre of [50, 400]) {
      const response = await request(app)
        .put('/api/users/me/gas-price')
        .set('Authorization', bearer(token))
        .send({ centsPerLitre });

      expect(response.status).toBe(200);
      expect(response.body.user.lastGasPrice.centsPerLitre).toBe(centsPerLitre);
    }
  });

  // Input: a valid session and centsPerLitre of 49.9, 400.1, 189.95, "189.9", or missing, or a body that isn't an object
  // Expected status code: 400
  // Expected behavior: each price is rejected and nothing is saved
  // Expected output: { error: "Invalid gas price" }
  test('Invalid prices are rejected', async () => {
    const { user, token } = await createSignedInUser();
    const app = createApp();
    const bodies: unknown[] = [
      { centsPerLitre: 49.9 },
      { centsPerLitre: 400.1 },
      { centsPerLitre: 189.95 },
      { centsPerLitre: '189.9' },
      {},
      [189.9],
    ];

    for (const body of bodies) {
      const response = await request(app)
        .put('/api/users/me/gas-price')
        .set('Authorization', bearer(token))
        .send(body as object);

      expect(response.status).toBe(400);
      expect(response.body).toStrictEqual({ error: 'Invalid gas price' });
    }
    const stored = await UserModel.findById(user._id).lean();
    expect(stored?.lastGasPrice).toBeNull();
  });

  // Input: no Authorization header and { centsPerLitre: 189.9 }
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).put('/api/users/me/gas-price').send({ centsPerLitre: 189.9 });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
  });
});
