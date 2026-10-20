import request from 'supertest';

import { createApp } from '../../src/app';
import { SessionModel } from '../../src/models/session.model';
import { TripModel } from '../../src/models/trip.model';
import { UserModel } from '../../src/models/user.model';
import { createSession } from '../../src/services/session.service';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { createTrip } from '../helpers/trips';

useTestDatabase();

// Interface DELETE /api/users/me
describe('Unmocked: DELETE /api/users/me', () => {
  // Input: Authorization header with a valid session token, for a user with two saved trips signed in on two devices
  // Expected status code: 204
  // Expected behavior: the user entry, their trips, and all of their sessions are deleted, so both devices are signed out
  // Expected output: empty body, and GET /api/users/me with either token then returns 401
  test('Account is deleted and every device is signed out', async () => {
    const { user, token: phoneToken } = await createSignedInUser();
    const tabletToken = await createSession(user._id);
    await createTrip(user._id);
    await createTrip(user._id);
    const app = createApp();

    const response = await request(app).delete('/api/users/me').set('Authorization', bearer(phoneToken));

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await UserModel.findById(user._id).lean()).toBeNull();
    expect(await SessionModel.countDocuments({ userId: user._id })).toBe(0);
    expect(await TripModel.countDocuments({ userId: user._id })).toBe(0);
    for (const token of [phoneToken, tabletToken]) {
      const after = await request(app).get('/api/users/me').set('Authorization', bearer(token));
      expect(after.status).toBe(401);
    }
  });

  // Input: a valid session token for one of two users
  // Expected status code: 204
  // Expected behavior: only that user, their trips, and their sessions are deleted
  // Expected output: GET /api/users/me with the other user's token still returns 200, and their trip is kept
  test("Other users' accounts are kept", async () => {
    const { user, token } = await createSignedInUser();
    const { user: other, token: otherToken } = await createSignedInUser();
    await createTrip(user._id);
    const otherTrip = await createTrip(other._id);
    const app = createApp();

    const response = await request(app).delete('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(204);
    const otherMe = await request(app).get('/api/users/me').set('Authorization', bearer(otherToken));
    expect(otherMe.status).toBe(200);
    expect(otherMe.body.user.id).toBe(other._id.toString());
    expect(await TripModel.find().distinct('_id')).toStrictEqual([otherTrip._id]);
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
