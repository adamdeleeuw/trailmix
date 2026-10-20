import { LoginTicket, OAuth2Client } from 'google-auth-library';
import request from 'supertest';

import { createApp } from '../../src/app';
import { SessionModel } from '../../src/models/session.model';
import { TripModel } from '../../src/models/trip.model';
import { UserModel } from '../../src/models/user.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { createTrip } from '../helpers/trips';

useTestDatabase();

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface DELETE /api/users/me
describe('Mocked: DELETE /api/users/me', () => {
  // Mocked behavior: Google accepts the token for the deleted account's Google ID when the user signs in again
  // Input: DELETE /api/users/me with a valid session, then POST /api/auth/google with the same Google account
  // Expected status code: 204, then 200
  // Expected behavior: signing in again creates a brand new account, so the user starts at the questionnaire
  // Expected output: { sessionToken, user } with a new id and profileComplete false
  test('Signing in again creates a new account', async () => {
    const { user, token } = await createSignedInUser({ googleId: 'google-sub-deleted', profileComplete: true });
    const app = createApp();
    jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation((() =>
      Promise.resolve(
        new LoginTicket('env', {
          iss: 'https://accounts.google.com',
          aud: 'test-client-id.apps.googleusercontent.com',
          iat: 0,
          exp: 0,
          sub: 'google-sub-deleted',
          email: user.email,
          name: user.name,
        }),
      )) as never);

    const deleted = await request(app).delete('/api/users/me').set('Authorization', bearer(token));
    const signIn = await request(app).post('/api/auth/google').send({ idToken: 'valid' });

    expect(deleted.status).toBe(204);
    expect(signIn.status).toBe(200);
    expect(signIn.body.user.id).not.toBe(user._id.toString());
    expect(signIn.body.user.profileComplete).toBe(false);
    expect(await UserModel.countDocuments({ googleId: 'google-sub-deleted' })).toBe(1);
  });

  // Mocked behavior: deleting the user fails
  // Input: Authorization header with a valid session token
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and the account and session are kept
  // Expected output: { error: "Internal Server Error" }
  test('Database error while deleting the user', async () => {
    const { user, token } = await createSignedInUser();
    jest.spyOn(UserModel, 'deleteOne').mockRejectedValueOnce(new Error('Simulated database error'));

    const response = await request(createApp()).delete('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(await UserModel.findById(user._id).lean()).not.toBeNull();
    expect(await SessionModel.countDocuments({ userId: user._id })).toBe(1);
  });

  // Mocked behavior: deleting the trips fails after the user is deleted
  // Input: Authorization header with a valid session token, for a user with a saved trip
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, the sessions are not deleted, and the leftover session no longer works because its account is gone
  // Expected output: { error: "Internal Server Error" }, and GET /api/users/me with the same token then returns 401
  test('Database error while deleting the trips', async () => {
    const { user, token } = await createSignedInUser();
    await createTrip(user._id);
    const app = createApp();
    const deleteTrips = jest.spyOn(TripModel, 'deleteMany').mockRejectedValueOnce(new Error('Simulated database error'));
    const deleteSessions = jest.spyOn(SessionModel, 'deleteMany');

    const response = await request(app).delete('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(deleteTrips).toHaveBeenCalledWith({ userId: user._id });
    expect(deleteSessions).not.toHaveBeenCalled();
    expect(await UserModel.findById(user._id).lean()).toBeNull();
    const after = await request(app).get('/api/users/me').set('Authorization', bearer(token));
    expect(after.status).toBe(401);
  });

  // Mocked behavior: deleting the sessions fails after the user is deleted
  // Input: Authorization header with a valid session token
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and the leftover session no longer works because its account is gone
  // Expected output: { error: "Internal Server Error" }, and GET /api/users/me with the same token then returns 401
  test('Database error while deleting the sessions', async () => {
    const { user, token } = await createSignedInUser();
    const app = createApp();
    jest.spyOn(SessionModel, 'deleteMany').mockRejectedValueOnce(new Error('Simulated database error'));

    const response = await request(app).delete('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(await UserModel.findById(user._id).lean()).toBeNull();
    const after = await request(app).get('/api/users/me').set('Authorization', bearer(token));
    expect(after.status).toBe(401);
  });
});
