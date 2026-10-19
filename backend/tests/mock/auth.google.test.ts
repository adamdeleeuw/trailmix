import { createHash } from 'node:crypto';
import { LoginTicket, OAuth2Client, type TokenPayload } from 'google-auth-library';
import request from 'supertest';

import { createApp } from '../../src/app';
import { SessionModel } from '../../src/models/session.model';
import { UserModel } from '../../src/models/user.model';
import { failingQuery, useTestDatabase } from '../helpers/db';

useTestDatabase();

const GOOGLE_ID = 'google-sub-123';

function googlePayload(
  overrides: Partial<TokenPayload> = {},
  omit: ('email' | 'name' | 'picture')[] = [],
): TokenPayload {
  const payload: TokenPayload = {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id.apps.googleusercontent.com',
    iat: 0,
    exp: 0,
    sub: GOOGLE_ID,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    picture: 'https://example.com/ada.png',
    ...overrides,
  };
  const omitted = new Set<string>(omit);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !omitted.has(key))) as TokenPayload;
}

// fakes Google's token check: automated tests can't get a real Google token
function mockGoogleVerify(payload: TokenPayload | undefined): jest.SpyInstance {
  return jest
    .spyOn(OAuth2Client.prototype, 'verifyIdToken')
    .mockImplementation((() => Promise.resolve(new LoginTicket('env', payload))) as never);
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface POST /api/auth/google
describe('Mocked: POST /api/auth/google', () => {
  // Mocked behavior: Google accepts the token for a Google account with no Trailmix account
  // Input: { idToken: "valid" }
  // Expected status code: 200
  // Expected behavior: a user and a session are created, and only the token's hash is stored
  // Expected output: { sessionToken, user: { id, email, name, photoUrl, profileComplete: false, timezone: null, vehicle: null, transit: null } }
  test('New user gets an account and a session', async () => {
    mockGoogleVerify(googlePayload());

    const response = await request(createApp()).post('/api/auth/google').send({ idToken: 'valid' });

    expect(response.status).toBe(200);
    const user = await UserModel.findOne({ googleId: GOOGLE_ID }).orFail().lean();
    expect(response.body).toEqual({
      sessionToken: expect.any(String),
      user: {
        id: user._id.toString(),
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        photoUrl: 'https://example.com/ada.png',
        profileComplete: false,
        timezone: null,
        vehicle: null,
        transit: null,
      },
    });
    const session = await SessionModel.findOne({ userId: user._id }).orFail().lean();
    const sessionToken: string = response.body.sessionToken;
    expect(session.tokenHash).toBe(createHash('sha256').update(sessionToken).digest('hex'));
    expect(session.tokenHash).not.toBe(sessionToken);
  });

  // Mocked behavior: Google accepts the token twice for the same Google account, with a new name and email the second time
  // Input: { idToken: "valid" } twice
  // Expected status code: 200 both times
  // Expected behavior: one user, refreshed from Google, with two separate sessions
  // Expected output: the same user id both times, with distinct session tokens
  test('Returning user does not get a duplicate account', async () => {
    const app = createApp();
    mockGoogleVerify(googlePayload());
    const first = await request(app).post('/api/auth/google').send({ idToken: 'valid' });
    mockGoogleVerify(googlePayload({ email: 'ada@new.example.com', name: 'Ada King' }));
    const second = await request(app).post('/api/auth/google').send({ idToken: 'valid' });

    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user).toMatchObject({ email: 'ada@new.example.com', name: 'Ada King' });
    expect(second.body.sessionToken).not.toBe(first.body.sessionToken);
    expect(await UserModel.countDocuments()).toBe(1);
    expect(await SessionModel.countDocuments()).toBe(2);
  });

  // Mocked behavior: Google accepts both tokens for the same new Google account
  // Input: two sign-ins sent at the same moment
  // Expected status code: 200 for both
  // Expected behavior: the unique googleId index allows only one account
  // Expected output: the same user id in both responses
  test('Concurrent first sign-ins create only one account', async () => {
    mockGoogleVerify(googlePayload());
    const app = createApp();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/api/auth/google').send({ idToken: 'valid' })),
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(responses[0]?.body.user.id);
    }
    expect(await UserModel.countDocuments()).toBe(1);
  });

  // Mocked behavior: Google accepts the token but gives no name or photo
  // Input: { idToken: "valid" }
  // Expected status code: 200
  // Expected behavior: the user is created with the email as their name
  // Expected output: user with name equal to the email and photoUrl null
  test('Google account without a name or photo', async () => {
    mockGoogleVerify(googlePayload({}, ['name', 'picture']));

    const response = await request(createApp()).post('/api/auth/google').send({ idToken: 'valid' });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ name: 'ada@example.com', photoUrl: null });
  });

  // Mocked behavior: Google rejects the token, gives a payload without an email, or gives no payload
  // Input: { idToken: "valid" }
  // Expected status code: 401
  // Expected behavior: no user or session is created
  // Expected output: { error: "Invalid credentials" }
  test('Google rejects the token or omits the email', async () => {
    const app = createApp();
    jest
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockImplementationOnce((() => Promise.reject(new Error('Google is down'))) as never);
    const rejected = await request(app).post('/api/auth/google').send({ idToken: 'valid' });
    mockGoogleVerify(googlePayload({}, ['email']));
    const noEmail = await request(app).post('/api/auth/google').send({ idToken: 'valid' });
    mockGoogleVerify(undefined);
    const noPayload = await request(app).post('/api/auth/google').send({ idToken: 'valid' });

    for (const response of [rejected, noEmail, noPayload]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid credentials' });
    }
    expect(await UserModel.countDocuments()).toBe(0);
    expect(await SessionModel.countDocuments()).toBe(0);
  });

  // Mocked behavior: Google accepts the token but the user upsert fails
  // Input: { idToken: "valid" }
  // Expected status code: 500
  // Expected behavior: error is handled without crashing and no session is created
  // Expected output: { error: "Internal Server Error" }
  test('Database error while saving the user', async () => {
    mockGoogleVerify(googlePayload());
    jest.spyOn(UserModel, 'findOneAndUpdate').mockReturnValueOnce(failingQuery());

    const response = await request(createApp()).post('/api/auth/google').send({ idToken: 'valid' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
    expect(await SessionModel.countDocuments()).toBe(0);
  });

  // Mocked behavior: Google accepts the token but creating the session fails
  // Input: { idToken: "valid" }
  // Expected status code: 500
  // Expected behavior: error is handled without crashing and no session is created
  // Expected output: { error: "Internal Server Error" }
  test('Database error while creating the session', async () => {
    mockGoogleVerify(googlePayload());
    jest.spyOn(SessionModel, 'create').mockRejectedValueOnce(new Error('Simulated database error'));

    const response = await request(createApp()).post('/api/auth/google').send({ idToken: 'valid' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
    expect(await SessionModel.countDocuments()).toBe(0);
  });
});
