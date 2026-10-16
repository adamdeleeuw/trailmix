import request from 'supertest';

import { createApp } from '../../src/app';
import { UserModel } from '../../src/models/user.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

// Interface GET /api/users/me
describe('Unmocked: GET /api/users/me', () => {
  // Input: Authorization header with a valid session token
  // Expected status code: 200
  // Expected behavior: the signed-in user's account is returned
  // Expected output: { user: { id, email, name, photoUrl, profileComplete } } with no googleId
  test('Valid session', async () => {
    const { user, token } = await createSignedInUser({ photoUrl: 'https://example.com/me.png' });

    const response = await request(createApp()).get('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        photoUrl: 'https://example.com/me.png',
        profileComplete: false,
      },
    });
  });

  // Input: no Authorization header, a header that isn't "Bearer <token>", or a token that matches no session
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('No session, malformed header, or fake session', async () => {
    const { token } = await createSignedInUser();
    const app = createApp();

    const responses = [
      await request(app).get('/api/users/me'),
      await request(app).get('/api/users/me').set('Authorization', token),
      await request(app).get('/api/users/me').set('Authorization', 'Bearer '),
      await request(app).get('/api/users/me').set('Authorization', bearer('fake-token')),
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    }
  });

  // Input: a valid session token whose user has been deleted
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('Session whose account was deleted', async () => {
    const { user, token } = await createSignedInUser();
    await UserModel.deleteOne({ _id: user._id });

    const response = await request(createApp()).get('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});
