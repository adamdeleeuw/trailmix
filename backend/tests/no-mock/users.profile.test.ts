import request from 'supertest';

import { createApp } from '../../src/app';
import { UserModel, type User } from '../../src/models/user.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

const corolla = { make: 'Toyota', model: 'Corolla', colour: 'Blue', litresPer100km: 7.2 };
const driverProfile = {
  timezone: 'America/Vancouver',
  vehicle: corolla,
  transit: { fareType: 'ADULT_STORED_VALUE' },
};

/** Sends a profile for a signed-in user. */
function putProfile(token: string, body: unknown): request.Test {
  return request(createApp())
    .put('/api/users/me/profile')
    .set('Authorization', bearer(token))
    .send(body as object);
}

/** Reads the stored user straight from the database. */
async function storedUser(user: User): Promise<User | null> {
  return UserModel.findById(user._id).lean();
}

// Interface PUT /api/users/me/profile
describe('Unmocked: PUT /api/users/me/profile', () => {
  // Input: a driver who pays per trip with an adult Compass Card
  // Expected status code: 200
  // Expected behavior: the profile is saved and marked finished
  // Expected output: { user } with the saved timezone, vehicle, transit and profileComplete true
  test('Driver with a pay-per-trip fare', async () => {
    const { user, token } = await createSignedInUser();

    const response = await putProfile(token, driverProfile);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        photoUrl: null,
        profileComplete: true,
        timezone: 'America/Vancouver',
        vehicle: corolla,
        transit: { fareType: 'ADULT_STORED_VALUE', monthlyPassZones: null },
      },
    });
    expect(await storedUser(user)).toMatchObject({ profileComplete: true, vehicle: corolla });
  });

  // Input: doesn't drive, doesn't take transit, and a timezone in lowercase
  // Expected status code: 200
  // Expected behavior: the profile is saved and marked finished, with the timezone's standard spelling
  // Expected output: { user } with vehicle null and transit null
  test("Doesn't drive and doesn't take transit", async () => {
    const { user, token } = await createSignedInUser();

    const response = await putProfile(token, { timezone: 'europe/london', vehicle: null, transit: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { profileComplete: true, vehicle: null, transit: null } });
    expect(await storedUser(user)).toMatchObject({ profileComplete: true, timezone: 'Europe/London' });
  });

  // Input: an adult monthly pass with 2 zones, and a car with no colour
  // Expected status code: 200
  // Expected behavior: the zones and the missing colour are saved
  // Expected output: { user } with transit { ADULT_MONTHLY_PASS, 2 } and colour null
  test('Adult monthly pass with zones', async () => {
    const { token } = await createSignedInUser();

    const response = await putProfile(token, {
      ...driverProfile,
      vehicle: { ...corolla, colour: null },
      transit: { fareType: 'ADULT_MONTHLY_PASS', monthlyPassZones: 2 },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user: {
        vehicle: { colour: null },
        transit: { fareType: 'ADULT_MONTHLY_PASS', monthlyPassZones: 2 },
      },
    });
  });

  // Input: a saved driver who resubmits as not driving
  // Expected status code: 200
  // Expected behavior: the saved vehicle is removed
  // Expected output: { user } with vehicle null
  test('Changing from driving to not driving', async () => {
    const { user, token } = await createSignedInUser();
    await putProfile(token, driverProfile);

    const response = await putProfile(token, { ...driverProfile, vehicle: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { vehicle: null } });
    expect(await storedUser(user)).toMatchObject({ vehicle: null });
  });

  // Input: each answer made invalid in turn (vehicle, transit, timezone, and the body itself)
  // Expected status code: 400
  // Expected behavior: request is rejected and nothing is saved
  // Expected output: { error: "Invalid profile" }
  test('Invalid answers', async () => {
    const { user, token } = await createSignedInUser();
    const invalidBodies: unknown[] = [
      { ...driverProfile, vehicle: { ...corolla, make: 'Tesla' } },
      { ...driverProfile, vehicle: { ...corolla, model: 'Civic' } },
      { ...driverProfile, vehicle: { ...corolla, make: { $ne: null } } },
      { ...driverProfile, vehicle: { ...corolla, litresPer100km: 0.9 } },
      { ...driverProfile, vehicle: { ...corolla, litresPer100km: 40.1 } },
      { ...driverProfile, vehicle: { ...corolla, litresPer100km: 7.25 } },
      { ...driverProfile, vehicle: { ...corolla, litresPer100km: '7.2' } },
      { ...driverProfile, vehicle: { ...corolla, colour: 'Pink' } },
      { ...driverProfile, vehicle: 'Corolla' },
      { ...driverProfile, transit: { fareType: 'FREE_RIDE' } },
      { ...driverProfile, transit: { fareType: 'ADULT_MONTHLY_PASS' } },
      { ...driverProfile, transit: { fareType: 'ADULT_MONTHLY_PASS', monthlyPassZones: 4 } },
      { ...driverProfile, transit: { fareType: 'UPASS', monthlyPassZones: 1 } },
      { ...driverProfile, transit: [] },
      { ...driverProfile, timezone: 'Mars/Olympus_Mons' },
      { ...driverProfile, timezone: '' },
      { ...driverProfile, timezone: 'A'.repeat(65) },
      { ...driverProfile, timezone: undefined },
      [driverProfile],
    ];

    for (const body of invalidBodies) {
      const response = await putProfile(token, body);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid profile' });
    }
    expect(await storedUser(user)).toMatchObject({ profileComplete: false, timezone: null, vehicle: null, transit: null });
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).put('/api/users/me/profile').send(driverProfile);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});
