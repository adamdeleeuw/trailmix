import { LoginTicket, OAuth2Client } from 'google-auth-library';
import { Types } from 'mongoose';
import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
import { UserModel } from '../../src/models/user.model';
import { bearer } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { parkingSpotBody } from '../helpers/parking-spots';
import { DOWNTOWN, tripBody } from '../helpers/trips';

useTestDatabase();

const GOOGLE_SUB = '104857600000000000001';
const PROFILE = {
  timezone: 'America/Vancouver',
  vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Blue', litresPer100km: 7.2 },
  transit: { fareType: 'CONCESSION_STORED_VALUE' },
};
const HOME_SPOT = parkingSpotBody({ label: 'Home on West 16th', placeId: 'ChIJ-home-spot', location: { lat: 49.2611, lng: -123.1388 } });

// what must never appear in a stored document: who the user is, their places, and their trip
const SECRETS = [
  GOOGLE_SUB, 'ada@example.com', 'Ada Lovelace', 'example.com/ada.png', 'America/Vancouver', 'Toyota', 'Corolla',
  'CONCESSION', '189.9', 'Home on West 16th', 'ChIJ-home-spot', '49.2611', '-123.1388', 'Downtown office', 'ChIJ-downtown',
  String(DOWNTOWN.lat), 'Expo Line', 'Production Way', 'drive-polyline', 'Lougheed',
];

beforeEach(() => {
  jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation((() => Promise.resolve(new LoginTicket('env', {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id.apps.googleusercontent.com',
    iat: 0,
    exp: 0,
    sub: GOOGLE_SUB,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    picture: 'https://example.com/ada.png',
  }))) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// signs in and fills in everything the app can save about a user
async function saveEverything(): Promise<{ token: string; userId: string; tripId: string }> {
  const app = createApp();
  const signIn = await request(app).post('/api/auth/google').send({ idToken: 'valid' });
  const token = signIn.body.sessionToken as string;
  const auth = { Authorization: bearer(token) };
  expect((await request(app).put('/api/users/me/profile').set(auth).send(PROFILE)).status).toBe(200);
  expect((await request(app).put('/api/users/me/gas-price').set(auth).send({ centsPerLitre: 189.9 })).status).toBe(200);
  expect((await request(app).put('/api/users/me/planning-preferences').set(auth)
    .send({ costVsTime: 80, defaultModes: ['TRANSIT'], maxWalkMinutes: 15 })).status).toBe(200);
  expect((await request(app).post('/api/users/me/parking-spots').set(auth).send(HOME_SPOT)).status).toBe(201);
  const trip = await request(app).post('/api/users/me/trips').set(auth).send(tripBody());
  expect(trip.status).toBe(201);
  return { token, userId: signIn.body.user.id as string, tripId: trip.body.trip.id as string };
}

// Interface every endpoint that saves user data (issue #89: all user data is encrypted at rest)
describe('Mocked: user data at rest', () => {
  // Mocked behavior: Google accepts the sign-in
  // Input: a user signs in, saves a profile, gas price, preferences, a spot named after their home and a trip
  // Expected behavior: the stored MongoDB documents contain no email, name, label, place ID, coordinate or route
  // Expected output: only ids, ownership, status, readable times and sealed values in the raw documents
  test('Stores no personal data in plaintext', async () => {
    const { userId, tripId } = await saveEverything();

    const storedUser = await UserModel.collection.findOne({});
    const storedTrip = await TripModel.collection.findOne({});
    const raw = JSON.stringify([storedUser, storedTrip]);

    for (const secret of SECRETS) expect(raw).not.toContain(secret);
    expect(storedUser?._id.toString()).toBe(userId);
    expect(storedTrip?._id.toString()).toBe(tripId);
    expect(storedTrip?.status).toBe('PLANNED');
  });

  // Mocked behavior: Google accepts the sign-in
  // Input: the same saves, then the app's reads
  // Expected status code: 200
  // Expected behavior: the encryption is invisible to the app
  // Expected output: the profile, spot and trip exactly as saved
  test('Returns the saved data unchanged', async () => {
    const { token } = await saveEverything();
    const app = createApp();
    const auth = { Authorization: bearer(token) };

    const me = await request(app).get('/api/users/me').set(auth);
    const spots = await request(app).get('/api/users/me/parking-spots').set(auth);
    const trips = await request(app).get('/api/users/me/trips').set(auth);

    expect(me.body.user).toMatchObject({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      timezone: 'America/Vancouver',
      vehicle: PROFILE.vehicle,
      transit: { fareType: 'CONCESSION_STORED_VALUE', monthlyPassZones: null },
      lastGasPrice: { centsPerLitre: 189.9 },
      costVsTime: 80,
      defaultModes: ['TRANSIT'],
      maxWalkMinutes: 15,
    });
    expect(spots.body.parkingSpots).toEqual([expect.objectContaining({ label: 'Home on West 16th', placeId: 'ChIJ-home-spot', location: HOME_SPOT.location })]);
    expect(trips.body.trips).toHaveLength(1);
    expect(trips.body.trips[0].destination).toEqual(DOWNTOWN);
  });

  // Mocked behavior: Google accepts the sign-in
  // Input: the same Google account signs in a second time
  // Expected status code: 200
  // Expected behavior: it's found by the hashed Google ID, so no second account is made
  // Expected output: the same account id
  test('Finds the account again by its hashed Google ID', async () => {
    const { userId } = await saveEverything();

    const again = await request(createApp()).post('/api/auth/google').send({ idToken: 'valid' });

    expect(again.body.user.id).toBe(userId);
    expect(await UserModel.countDocuments()).toBe(1);
  });

  // Mocked behavior: Google accepts the sign-in
  // Input: an account saved before encryption, with Google's plain ID, signs in before the migration runs
  // Expected status code: 200
  // Expected behavior: it's still the same account, and its Google ID is replaced by the hash on the way
  // Expected output: the old account's id, and one account in the database
  test('Signs in an account saved before encryption', async () => {
    const { insertedId } = await UserModel.collection.insertOne({
      googleId: GOOGLE_SUB, email: 'old@example.com', name: 'Old Name', photoUrl: null, profileComplete: false,
      createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await request(createApp()).post('/api/auth/google').send({ idToken: 'valid' });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: insertedId.toString(), email: 'ada@example.com', name: 'Ada Lovelace' });
    expect(await UserModel.countDocuments()).toBe(1);
    expect(JSON.stringify(await UserModel.collection.findOne({}))).not.toContain(GOOGLE_SUB);
  });

  // Mocked behavior: Google accepts the sign-in
  // Input: the saved spot's place saved a second time
  // Expected status code: 409
  // Expected behavior: the duplicate check still works, on the place ID's hash
  // Expected output: { error }
  test('Still refuses a duplicate place', async () => {
    const { token } = await saveEverything();

    const response = await request(createApp()).post('/api/users/me/parking-spots').set('Authorization', bearer(token))
      .send({ ...HOME_SPOT, label: 'Home again' });

    expect(response.status).toBe(409);
  });

  // Mocked behavior: Google accepts the sign-in for two accounts
  // Input: someone with database access copies one user's sealed email into another user's document
  // Expected status code: 500
  // Expected behavior: the copy doesn't open, because each value is bound to its own document
  // Expected output: { error: "Internal Server Error" }, never the other user's email
  test("Won't open a value copied from another account", async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { userId } = await saveEverything();
    jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation((() => Promise.resolve(new LoginTicket('env', {
      iss: 'https://accounts.google.com', aud: 'test-client-id.apps.googleusercontent.com', iat: 0, exp: 0,
      sub: 'another-account', email: 'bob@example.com', name: 'Bob',
    }))) as never);
    const bob = await request(createApp()).post('/api/auth/google').send({ idToken: 'valid' });
    const ada = await UserModel.collection.findOne({ _id: new Types.ObjectId(userId) });
    await UserModel.collection.updateOne({ _id: new Types.ObjectId(bob.body.user.id as string) }, { $set: { email: ada?.email } });

    const response = await request(createApp()).get('/api/users/me').set('Authorization', bearer(bob.body.sessionToken as string));

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('ada@example.com');
  });
});
