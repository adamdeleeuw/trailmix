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
  // Expected output: { user: { id, email, name, photoUrl, profileComplete, timezone, vehicle, transit, lastGasPrice } } with no googleId
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
        timezone: null,
        vehicle: null,
        transit: null,
        lastGasPrice: null,
      },
    });
  });

  // Input: Authorization header for a user who has submitted the questionnaire
  // Expected status code: 200
  // Expected behavior: the saved profile is returned with the account
  // Expected output: { user } with profileComplete true and the saved timezone, vehicle and transit
  test('Returns the saved profile after it is submitted', async () => {
    const { token } = await createSignedInUser();
    const app = createApp();
    const profile = {
      timezone: 'America/Vancouver',
      vehicle: { make: 'Honda', model: 'Civic', colour: null, litresPer100km: 6.5 },
      transit: { fareType: 'ADULT_MONTHLY_PASS', monthlyPassZones: 3 },
    };
    await request(app).put('/api/users/me/profile').set('Authorization', bearer(token)).send(profile);

    const response = await request(app).get('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { profileComplete: true, ...profile } });
  });

  // Input: Authorization header for a user who has saved a gas price
  // Expected status code: 200
  // Expected behavior: the last gas price is returned with the date it was saved
  // Expected output: { user } whose lastGasPrice is { centsPerLitre: 189.9, savedAt } with savedAt as an ISO date
  test('Returns the last gas price and the date it was saved', async () => {
    const savedAt = new Date('2026-10-14T17:30:00.000Z');
    const { token } = await createSignedInUser({ lastGasPrice: { centsPerLitre: 189.9, savedAt } });

    const response = await request(createApp()).get('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.user.lastGasPrice).toStrictEqual({ centsPerLitre: 189.9, savedAt: savedAt.toISOString() });
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
