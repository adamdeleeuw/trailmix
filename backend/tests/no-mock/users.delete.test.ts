import request from 'supertest';

import { createApp } from '../../src/app';
import { SessionModel } from '../../src/models/session.model';
import { UserModel } from '../../src/models/user.model';
import { createSession } from '../../src/services/session.service';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

// Interface DELETE /api/users/me
describe('Unmocked: DELETE /api/users/me', () => {
  // Input: Authorization header with a valid session token, for a user signed in on two devices
  // Expected status code: 204
  // Expected behavior: the user entry and all of their sessions are deleted, so both devices are signed out
  // Expected output: empty body, and GET /api/users/me with either token then returns 401
  test('Account is deleted and every device is signed out', async () => {
    const { user, token: phoneToken } = await createSignedInUser();
    const tabletToken = await createSession(user._id);
    const app = createApp();

    const response = await request(app).delete('/api/users/me').set('Authorization', bearer(phoneToken));

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await UserModel.findById(user._id).lean()).toBeNull();
    expect(await SessionModel.countDocuments({ userId: user._id })).toBe(0);
    for (const token of [phoneToken, tabletToken]) {
      const after = await request(app).get('/api/users/me').set('Authorization', bearer(token));
      expect(after.status).toBe(401);
    }
  });

  // Input: a valid session token for one of two users
  // Expected status code: 204
  // Expected behavior: only that user and their sessions are deleted
  // Expected output: GET /api/users/me with the other user's token still returns 200
  test("Other users' accounts are kept", async () => {
    const { token } = await createSignedInUser();
    const { user: other, token: otherToken } = await createSignedInUser();
    const app = createApp();

    const response = await request(app).delete('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(204);
    const otherMe = await request(app).get('/api/users/me').set('Authorization', bearer(otherToken));
    expect(otherMe.status).toBe(200);
    expect(otherMe.body.user.id).toBe(other._id.toString());
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected and nothing is deleted
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    await createSignedInUser();

    const response = await request(createApp()).delete('/api/users/me');

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
    expect(await UserModel.countDocuments()).toBe(1);
    expect(await SessionModel.countDocuments()).toBe(1);
  });
});
