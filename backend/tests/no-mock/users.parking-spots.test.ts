import request from 'supertest';

import { createApp } from '../../src/app';
import { getParkingSpots } from '../../src/services/parking-spot.service';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { addParkingSpots, parkingSpotBody } from '../helpers/parking-spots';

useTestDatabase();

const PATH = '/api/users/me/parking-spots';
const UNKNOWN_ID = '0123456789abcdef01234567';

// Interface GET /api/users/me/parking-spots
describe('Unmocked: GET /api/users/me/parking-spots', () => {
  // Input: a valid session for a user who has never saved a spot
  // Expected status code: 200
  // Expected behavior: nothing is changed
  // Expected output: { parkingSpots: [] }
  test('New user has no spots', async () => {
    const { token } = await createSignedInUser();

    const response = await request(createApp()).get(PATH).set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ parkingSpots: [] });
  });

  // Input: a valid session for a user who saved a dropped pin, then UBC North Parkade
  // Expected status code: 200
  // Expected behavior: only this user's spots are returned
  // Expected output: { parkingSpots } with North Parkade first, then the dropped pin, each with every field
  test("User's spots are returned newest first", async () => {
    const { token } = await createSignedInUser();
    const { user: other } = await createSignedInUser();
    await addParkingSpots(other._id, 1);
    const app = createApp();
    const pin = await request(app).post(PATH).set('Authorization', bearer(token))
      .send(parkingSpotBody({ label: 'Dropped pin', placeId: null, rateCents: null, ratePer: null }));
    const parkade = await request(app).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());

    const response = await request(app).get(PATH).set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ parkingSpots: [parkade.body.parkingSpot, pin.body.parkingSpot] });
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).get(PATH);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
  });
});

// Interface POST /api/users/me/parking-spots
describe('Unmocked: POST /api/users/me/parking-spots', () => {
  // Input: a valid session and UBC North Parkade at 300 cents per HOUR with no overnight parking
  // Expected status code: 201
  // Expected behavior: the spot is saved for the user with the time the server received it
  // Expected output: { parkingSpot } with a new id, every field sent, and createdAt set to now
  test('Valid spot is saved and returned with an id', async () => {
    const { user, token } = await createSignedInUser();
    const before = Date.now();

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());

    const after = Date.now();
    expect(response.status).toBe(201);
    const { id, createdAt, ...fields } = response.body.parkingSpot;
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(fields).toStrictEqual({
      label: 'UBC North Parkade',
      location: { lat: 49.2697, lng: -123.2513 },
      placeId: 'ChIJ-north-parkade',
      rateCents: 300,
      ratePer: 'HOUR',
      overnightAllowed: false,
    });
    const savedAt = Date.parse(String(createdAt));
    expect(savedAt).toBeGreaterThanOrEqual(before);
    expect(savedAt).toBeLessThanOrEqual(after);
    const stored = await getParkingSpots(user._id);
    expect(stored.map((spot) => spot._id.toString())).toStrictEqual([id]);
  });

  // Input: a valid session and a dropped pin with only a padded label and a location
  // Expected status code: 201
  // Expected behavior: the label is trimmed and the missing fields get their defaults
  // Expected output: { parkingSpot } with placeId, rateCents and ratePer null and overnightAllowed true
  test('Optional fields default to unknown cost and overnight allowed', async () => {
    const { token } = await createSignedInUser();

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token))
      .send({ label: '  Side street  ', location: { lat: 49.26, lng: -123.17 } });

    expect(response.status).toBe(201);
    expect(response.body.parkingSpot).toMatchObject({
      label: 'Side street',
      placeId: null,
      rateCents: null,
      ratePer: null,
      overnightAllowed: true,
    });
  });

  // Input: a valid session and spots at the limits: a 1- and a 60-character name, coordinates at ±90 and ±180,
  // a free spot (0 cents per DAY), and a $999.99 spot
  // Expected status code: 201
  // Expected behavior: every spot is saved
  // Expected output: { parkingSpot } for each
  test('Values at the limits are accepted', async () => {
    const { user, token } = await createSignedInUser();
    const app = createApp();
    const bodies = [
      parkingSpotBody({ label: 'P', placeId: null }),
      parkingSpotBody({ label: 'x'.repeat(60), placeId: null }),
      parkingSpotBody({ location: { lat: 90, lng: 180 }, placeId: null }),
      parkingSpotBody({ location: { lat: -90, lng: -180 }, placeId: null }),
      parkingSpotBody({ rateCents: 0, ratePer: 'DAY', placeId: null }),
      parkingSpotBody({ rateCents: 99999, placeId: null }),
    ];

    for (const body of bodies) {
      const response = await request(app).post(PATH).set('Authorization', bearer(token)).send(body);
      expect(response.status).toBe(201);
    }
    expect(await getParkingSpots(user._id)).toHaveLength(bodies.length);
  });

  // Input: a valid session and a missing, blank or 61-character name, latitude 90.1 or longitude -180.1,
  // a missing or non-object location, a negative, fractional, too large or string cost, an unknown unit,
  // a cost without a unit or a unit without a cost, an empty placeId, a non-boolean overnightAllowed,
  // or a body that isn't an object
  // Expected status code: 400
  // Expected behavior: each spot is rejected and nothing is saved
  // Expected output: { error: "Invalid parking spot" }
  test('Invalid spots are rejected', async () => {
    const { user, token } = await createSignedInUser();
    const app = createApp();
    const bodies: unknown[] = [
      parkingSpotBody({ label: undefined }),
      parkingSpotBody({ label: '   ' }),
      parkingSpotBody({ label: 'x'.repeat(61) }),
      parkingSpotBody({ label: 42 }),
      parkingSpotBody({ location: { lat: 90.1, lng: -123.1 } }),
      parkingSpotBody({ location: { lat: 49.2, lng: -180.1 } }),
      parkingSpotBody({ location: { lat: '49.2', lng: -123.1 } }),
      parkingSpotBody({ location: undefined }),
      parkingSpotBody({ location: [49.2, -123.1] }),
      parkingSpotBody({ rateCents: -1 }),
      parkingSpotBody({ rateCents: 2.5 }),
      parkingSpotBody({ rateCents: 100000 }),
      parkingSpotBody({ rateCents: '300' }),
      parkingSpotBody({ ratePer: 'WEEK' }),
      parkingSpotBody({ ratePer: null }),
      parkingSpotBody({ rateCents: null }),
      parkingSpotBody({ placeId: '' }),
      parkingSpotBody({ placeId: 7 }),
      parkingSpotBody({ overnightAllowed: 'no' }),
      [parkingSpotBody()],
    ];

    for (const body of bodies) {
      const response = await request(app).post(PATH).set('Authorization', bearer(token)).send(body as object);
      expect(response.status).toBe(400);
      expect(response.body).toStrictEqual({ error: 'Invalid parking spot' });
    }
    expect(await getParkingSpots(user._id)).toHaveLength(0);
  });

  // Input: a valid session for a user who already has 20 spots, and a new valid spot
  // Expected status code: 409
  // Expected behavior: the 21st spot is rejected and the 20 are kept
  // Expected output: { error: "Parking spot limit reached" }
  test('A 21st spot is rejected', async () => {
    const { user, token } = await createSignedInUser();
    await addParkingSpots(user._id, 20);

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'Parking spot limit reached' });
    expect(await getParkingSpots(user._id)).toHaveLength(20);
  });

  // Input: a valid session and UBC North Parkade sent twice, once with a different name
  // Expected status code: 201, then 409
  // Expected behavior: only the first save is kept
  // Expected output: { parkingSpot }, then { error: "Parking spot already saved" }
  test('The same placeId twice is rejected', async () => {
    const { user, token } = await createSignedInUser();
    const app = createApp();

    const first = await request(app).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());
    const second = await request(app).post(PATH).set('Authorization', bearer(token))
      .send(parkingSpotBody({ label: 'North Parkade again' }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body).toStrictEqual({ error: 'Parking spot already saved' });
    const stored = await getParkingSpots(user._id);
    expect(stored.map((spot) => spot.label)).toStrictEqual(['UBC North Parkade']);
  });

  // Input: a valid session and two dropped pins (no placeId) at the same location
  // Expected status code: 201 for both
  // Expected behavior: both are saved, since dropped pins have no place ID to compare
  // Expected output: { parkingSpot } for each
  test('Dropped pins without a placeId are never duplicates', async () => {
    const { user, token } = await createSignedInUser();
    const app = createApp();
    const pin = parkingSpotBody({ label: 'Dropped pin', placeId: null });

    for (let i = 0; i < 2; i += 1) {
      const response = await request(app).post(PATH).set('Authorization', bearer(token)).send(pin);
      expect(response.status).toBe(201);
    }
    expect(await getParkingSpots(user._id)).toHaveLength(2);
  });

  // Input: two users each saving UBC North Parkade
  // Expected status code: 201 for both
  // Expected behavior: the duplicate check is per user
  // Expected output: { parkingSpot } for each
  test('Different users can save the same place', async () => {
    const { token } = await createSignedInUser();
    const { token: otherToken } = await createSignedInUser();
    const app = createApp();

    const first = await request(app).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());
    const second = await request(app).post(PATH).set('Authorization', bearer(otherToken)).send(parkingSpotBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  // Input: no Authorization header and a valid spot
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).post(PATH).send(parkingSpotBody());

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
  });
});

// Interface PUT /api/users/me/parking-spots/:id
describe('Unmocked: PUT /api/users/me/parking-spots/:id', () => {
  // Input: a valid session, the id of the user's North Parkade spot, and { label: "Home parkade", rateCents: 1500,
  // ratePer: "DAY", overnightAllowed: true }
  // Expected status code: 200
  // Expected behavior: the name, cost and overnight rule change; the id, place and createdAt stay the same
  // Expected output: { parkingSpot } with the new details
  test('Spot details are changed', async () => {
    const { user, token } = await createSignedInUser();
    const app = createApp();
    const saved = await request(app).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());
    const spot = saved.body.parkingSpot;

    const response = await request(app).put(`${PATH}/${spot.id}`).set('Authorization', bearer(token))
      .send({ label: 'Home parkade', rateCents: 1500, ratePer: 'DAY', overnightAllowed: true });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      parkingSpot: { ...spot, label: 'Home parkade', rateCents: 1500, ratePer: 'DAY', overnightAllowed: true },
    });
    const stored = await getParkingSpots(user._id);
    expect(stored[0]?.label).toBe('Home parkade');
  });

  // Input: a valid session, the id of a spot with a cost, and { label: "Free now" }
  // Expected status code: 200
  // Expected behavior: leaving the cost out makes it unknown, and overnight parking becomes allowed
  // Expected output: { parkingSpot } with rateCents and ratePer null and overnightAllowed true
  test('Leaving out the cost clears it', async () => {
    const { token } = await createSignedInUser();
    const app = createApp();
    const saved = await request(app).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());

    const response = await request(app).put(`${PATH}/${saved.body.parkingSpot.id}`)
      .set('Authorization', bearer(token)).send({ label: 'Free now' });

    expect(response.status).toBe(200);
    expect(response.body.parkingSpot).toMatchObject({ rateCents: null, ratePer: null, overnightAllowed: true });
  });

  // Input: a valid session, the id of the user's spot, and a 61-character name or a negative cost
  // Expected status code: 400
  // Expected behavior: nothing is changed
  // Expected output: { error: "Invalid parking spot" }
  test('Invalid details are rejected', async () => {
    const { user, token } = await createSignedInUser();
    const [spot] = await addParkingSpots(user._id, 1);
    const app = createApp();

    for (const body of [{ label: 'x'.repeat(61) }, { label: 'Spot', rateCents: -1, ratePer: 'HOUR' }, 'Spot']) {
      const response = await request(app).put(`${PATH}/${String(spot?._id)}`)
        .set('Authorization', bearer(token)).send(body);
      expect(response.status).toBe(400);
      expect(response.body).toStrictEqual({ error: 'Invalid parking spot' });
    }
    expect(await getParkingSpots(user._id)).toStrictEqual([spot]);
  });

  // Input: a valid session and another user's spot id, an unknown id, or an id that isn't a MongoDB id
  // Expected status code: 404
  // Expected behavior: nothing is changed for either user
  // Expected output: { error: "Parking spot not found" }
  test("Someone else's or an unknown spot is not found", async () => {
    const { token } = await createSignedInUser();
    const { user: other } = await createSignedInUser();
    const [otherSpot] = await addParkingSpots(other._id, 1);
    const app = createApp();

    for (const id of [String(otherSpot?._id), UNKNOWN_ID, 'not-an-id']) {
      const response = await request(app).put(`${PATH}/${id}`).set('Authorization', bearer(token))
        .send({ label: 'Mine now' });
      expect(response.status).toBe(404);
      expect(response.body).toStrictEqual({ error: 'Parking spot not found' });
    }
    expect(await getParkingSpots(other._id)).toStrictEqual([otherSpot]);
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).put(`${PATH}/${UNKNOWN_ID}`).send({ label: 'Spot' });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
  });
});

// Interface DELETE /api/users/me/parking-spots/:id
describe('Unmocked: DELETE /api/users/me/parking-spots/:id', () => {
  // Input: a valid session and the id of one of the user's two spots
  // Expected status code: 204
  // Expected behavior: only that spot is removed
  // Expected output: empty body
  test('Spot is removed', async () => {
    const { user, token } = await createSignedInUser();
    const [newer, older] = await addParkingSpots(user._id, 2);

    const response = await request(createApp()).delete(`${PATH}/${String(newer?._id)}`)
      .set('Authorization', bearer(token));

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await getParkingSpots(user._id)).toStrictEqual([older]);
  });

  // Input: a valid session and another user's spot id, an unknown id, or an id that isn't a MongoDB id
  // Expected status code: 404
  // Expected behavior: nothing is changed for either user
  // Expected output: { error: "Parking spot not found" }
  test("Someone else's or an unknown spot is not found", async () => {
    const { user, token } = await createSignedInUser();
    const { user: other } = await createSignedInUser();
    const mine = await addParkingSpots(user._id, 1);
    const theirs = await addParkingSpots(other._id, 1);
    const app = createApp();

    for (const id of [String(theirs[0]?._id), UNKNOWN_ID, 'not-an-id']) {
      const response = await request(app).delete(`${PATH}/${id}`).set('Authorization', bearer(token));
      expect(response.status).toBe(404);
      expect(response.body).toStrictEqual({ error: 'Parking spot not found' });
    }
    expect(await getParkingSpots(user._id)).toStrictEqual(mine);
    expect(await getParkingSpots(other._id)).toStrictEqual(theirs);
  });

  // Input: no Authorization header
  // Expected status code: 401
  // Expected behavior: request is rejected and nothing is deleted
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const { user } = await createSignedInUser();
    const spots = await addParkingSpots(user._id, 1);

    const response = await request(createApp()).delete(`${PATH}/${String(spots[0]?._id)}`);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
    expect(await getParkingSpots(user._id)).toStrictEqual(spots);
  });
});
