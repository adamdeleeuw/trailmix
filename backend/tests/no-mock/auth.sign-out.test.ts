import request from 'supertest';

import { createApp } from '../../src/app';
import { SessionModel } from '../../src/models/session.model';
import { createSession } from '../../src/services/session.service';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

// Interface POST /api/auth/sign-out
describe('Unmocked: POST /api/auth/sign-out', () => {
  // Input: Authorization header with a valid session token
  // Expected status code: 204
  // Expected behavior: the session is deleted, so the token no longer works
  // Expected output: empty body, and GET /api/users/me with the same token then returns 401
  test('Session stops working after sign-out', async () => {
    const { token } = await createSignedInUser();
    const app = createApp();

    const response = await request(app).post('/api/auth/sign-out').set('Authorization', bearer(token));

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await SessionModel.countDocuments()).toBe(0);
    const after = await request(app).get('/api/users/me').set('Authorization', bearer(token));
    expect(after.status).toBe(401);
  });

  // Input: sign-out from one of two sessions belonging to the same user
  // Expected status code: 204
  // Expected behavior: only that session is deleted, so the other device stays signed in
  // Expected output: GET /api/users/me with the other token still returns 200
  test("The same user's other devices stay signed in", async () => {
    const { user, token: phoneToken } = await createSignedInUser();
    const tabletToken = await createSession(user._id);
    const app = createApp();

    const response = await request(app).post('/api/auth/sign-out').set('Authorization', bearer(phoneToken));

    expect(response.status).toBe(204);
    const tablet = await request(app).get('/api/users/me').set('Authorization', bearer(tabletToken));
    expect(tablet.status).toBe(200);
    expect(tablet.body.user.id).toBe(user._id.toString());
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected and no session is deleted
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    await createSignedInUser();

    const response = await request(createApp()).post('/api/auth/sign-out');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
    expect(await SessionModel.countDocuments()).toBe(1);
  });
});
