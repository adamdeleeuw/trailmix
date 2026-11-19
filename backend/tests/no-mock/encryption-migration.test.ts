import { Types } from 'mongoose';
import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
import { UserModel } from '../../src/models/user.model';
import { sealPlaintextDocuments } from '../../src/services/encryption-migration.service';
import { lookupHash } from '../../src/services/field-crypto';
import { createSession } from '../../src/services/session.service';
import { bearer } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

const GOOGLE_SUB = '115500000000000000042';
const SAVED = new Date('2026-10-01T12:00:00.000Z');
const PLACE = { label: 'Old office', lat: 49.2827, lng: -123.1207, placeId: 'ChIJ-old-office' };
const HOME = { label: 'Old home', lat: 49.2401, lng: -123.0544, placeId: null };

// a user and a trip as they were stored before encryption, the trip from before CP2 (a midpoint, no status)
async function insertPlaintextData(): Promise<{ token: string; userId: Types.ObjectId; tripId: Types.ObjectId }> {
  const userId = new Types.ObjectId();
  const tripId = new Types.ObjectId();
  await UserModel.collection.insertOne({
    _id: userId,
    googleId: GOOGLE_SUB,
    email: 'grace@example.com',
    name: 'Grace Hopper',
    photoUrl: null,
    profileComplete: true,
    timezone: 'America/Vancouver',
    vehicle: { make: 'Honda', model: 'Civic', colour: null, litresPer100km: 6.5 },
    transit: null,
    lastGasPrice: { centsPerLitre: 175.5, savedAt: SAVED },
    parkingSpots: [{
      _id: new Types.ObjectId(), label: 'Old lot', location: { lat: 49.2501, lng: -123.0011 }, placeId: 'ChIJ-old-lot',
      rateCents: 250, ratePer: 'HOUR', overnightAllowed: false, createdAt: SAVED,
    }],
    createdAt: SAVED,
    updatedAt: SAVED,
  });
  await TripModel.collection.insertOne({
    _id: tripId,
    userId,
    origin: HOME,
    midpoint: PLACE,
    destination: PLACE,
    legs: [{ mode: 'DRIVE', from: HOME, to: PLACE, durationSeconds: 900, distanceMeters: 8000, costCents: 200, polyline: 'old-polyline', transitLines: [] }],
    totalDurationSeconds: 900,
    totalCostCents: 200,
    tripDate: SAVED,
    seeded: false,
    createdAt: SAVED,
    updatedAt: SAVED,
  });
  return { token: await createSession(userId), userId, tripId };
}

// everything the app can read about the user
async function readAll(token: string): Promise<unknown[]> {
  const app = createApp();
  const auth = { Authorization: bearer(token) };
  const responses = await Promise.all(['/api/users/me', '/api/users/me/parking-spots', '/api/users/me/trips']
    .map((path) => request(app).get(path).set(auth)));
  for (const response of responses) expect(response.status).toBe(200);
  return responses.map((response) => response.body as unknown);
}

// the stored documents as text, to search for plaintext
async function rawDocuments(): Promise<string> {
  return JSON.stringify([await UserModel.collection.find().toArray(), await TripModel.collection.find().toArray()]);
}

// Interface the one-time migration, scripts/encrypt-existing.ts (issue #89: seal the data saved before encryption)
describe('Unmocked: sealing data saved before encryption', () => {
  // Input: a plaintext user with a parking spot, and a plaintext trip from before CP2, read through the API
  // Expected status code: 200
  // Expected behavior: the app reads data saved before encryption, so it keeps working until the migration runs
  // Expected output: the user's email, spot and trip, with the old trip's midpoint as its transfer point
  test('Reads plaintext saved before encryption', async () => {
    const { token } = await insertPlaintextData();

    const [me, spots, trips] = await readAll(token) as [{ user: { email: string } }, { parkingSpots: { label: string }[] }, { trips: { status: string; transferPoints: unknown[] }[] }];

    expect(me.user.email).toBe('grace@example.com');
    expect(spots.parkingSpots[0]?.label).toBe('Old lot');
    expect(trips.trips[0]?.status).toBe('COMPLETED');
    expect(trips.trips[0]?.transferPoints).toEqual([PLACE]);
  });

  // Input: a dry run over one plaintext user and one plaintext trip
  // Expected behavior: it counts them and writes nothing
  // Expected output: { users: 1, trips: 1, sealed: 0, changedDuringRun: 0 }, and the documents unchanged
  test('Only counts on a dry run', async () => {
    await insertPlaintextData();
    const before = await rawDocuments();

    const report = await sealPlaintextDocuments(false);

    expect(report).toEqual({ users: 1, trips: 1, sealed: 0, changedDuringRun: 0 });
    expect(await rawDocuments()).toBe(before);
  });

  // Input: the migration applied to one plaintext user and one plaintext trip
  // Expected behavior: no personal data is left in the stored documents, the Google ID is replaced by its hash,
  //                    and the app reads exactly what it read before
  // Expected output: { users: 1, trips: 1, sealed: 2, changedDuringRun: 0 }
  test('Seals every plaintext field, and the app reads the same data', async () => {
    const { token, userId } = await insertPlaintextData();
    const before = await readAll(token);

    const report = await sealPlaintextDocuments(true);

    expect(report).toEqual({ users: 1, trips: 1, sealed: 2, changedDuringRun: 0 });
    const raw = await rawDocuments();
    for (const secret of [GOOGLE_SUB, 'grace@example.com', 'Grace Hopper', 'Honda', 'Old lot', 'ChIJ-old-lot', '49.2501', 'Old office', 'ChIJ-old-office', '49.2827', 'old-polyline']) {
      expect(raw).not.toContain(secret);
    }
    expect((await UserModel.collection.findOne({ _id: userId }))?.googleId).toBe(lookupHash(GOOGLE_SUB));
    expect(await readAll(token)).toEqual(before);
  });

  // Input: the migration run a second time
  // Expected behavior: nothing is left to seal, so nothing changes
  // Expected output: { users: 0, trips: 0, sealed: 0, changedDuringRun: 0 }
  test('Finds nothing to do the second time', async () => {
    await insertPlaintextData();
    await sealPlaintextDocuments(true);
    const after = await rawDocuments();

    expect(await sealPlaintextDocuments(true)).toEqual({ users: 0, trips: 0, sealed: 0, changedDuringRun: 0 });
    expect(await rawDocuments()).toBe(after);
  });

  // Input: before the migration, the user renames their old spot, then the migration runs
  // Expected status code: 200
  // Expected behavior: a half-sealed spot reads correctly, and the migration seals the rest of it
  // Expected output: the new name with the original place, before and after the migration
  test('Edits a spot saved before encryption', async () => {
    const { token, userId } = await insertPlaintextData();
    const spotId = (await UserModel.collection.findOne({ _id: userId }))?.parkingSpots[0]._id as Types.ObjectId;
    const app = createApp();
    const auth = { Authorization: bearer(token) };

    const edit = await request(app).put(`/api/users/me/parking-spots/${spotId.toString()}`).set(auth)
      .send({ label: 'Renamed lot', rateCents: null, ratePer: null, overnightAllowed: true });
    await sealPlaintextDocuments(true);
    const spots = await request(app).get('/api/users/me/parking-spots').set(auth);

    expect(edit.status).toBe(200);
    expect(edit.body.parkingSpot).toMatchObject({ label: 'Renamed lot', location: { lat: 49.2501, lng: -123.0011 } });
    expect(spots.body.parkingSpots).toEqual([edit.body.parkingSpot]);
    expect(await rawDocuments()).not.toContain('49.2501');
  });

  // Input: before the migration, the user saves their old spot's place again
  // Expected status code: 409
  // Expected behavior: the duplicate check still sees spots saved before encryption
  // Expected output: { error }
  test('Refuses a duplicate of a spot saved before encryption', async () => {
    const { token } = await insertPlaintextData();

    const response = await request(createApp()).post('/api/users/me/parking-spots').set('Authorization', bearer(token)).send({
      label: 'Same lot', location: { lat: 49.2501, lng: -123.0011 }, placeId: 'ChIJ-old-lot',
      rateCents: null, ratePer: null, overnightAllowed: true,
    });

    expect(response.status).toBe(409);
  });
});
