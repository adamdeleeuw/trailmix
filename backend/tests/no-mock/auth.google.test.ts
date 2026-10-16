import request from 'supertest';

import { createApp } from '../../src/app';
import { UserModel } from '../../src/models/user.model';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

// Interface POST /api/auth/google
describe('Unmocked: POST /api/auth/google', () => {
  // Input: POST with no request body
  // Expected status code: 400
  // Expected behavior: request is rejected and no user is created
  // Expected output: { error: "No idToken" }
  test('Missing body', async () => {
    const response = await request(createApp()).post('/api/auth/google');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'No idToken' });
    expect(await UserModel.countDocuments()).toBe(0);
  });

  // Input: { idToken: 123 } and { idToken: "" }
  // Expected status code: 400
  // Expected behavior: request is rejected and no user is created
  // Expected output: { error: "No idToken" }
  test('idToken is not a non-empty string', async () => {
    const app = createApp();
    for (const idToken of [123, '']) {
      const response = await request(app).post('/api/auth/google').send({ idToken });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'No idToken' });
    }
    expect(await UserModel.countDocuments()).toBe(0);
  });

  // Input: a body that isn't valid JSON
  // Expected status code: 400
  // Expected behavior: request is rejected without reaching the controller
  // Expected output: { error: "Malformed JSON" }
  test('Malformed JSON body', async () => {
    const response = await request(createApp())
      .post('/api/auth/google')
      .set('Content-Type', 'application/json')
      .send('{"idToken":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Malformed JSON' });
  });

  // Input: { idToken: "not-a-real-google-token" }
  // Expected status code: 401
  // Expected behavior: Google's library rejects the token, so no user is created
  // Expected output: { error: "Invalid credentials" }
  test('Invalid Google token', async () => {
    const response = await request(createApp())
      .post('/api/auth/google')
      .send({ idToken: 'not-a-real-google-token' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
    expect(await UserModel.countDocuments()).toBe(0);
  });
});
