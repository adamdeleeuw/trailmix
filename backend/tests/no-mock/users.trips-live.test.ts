import request from 'supertest';
import { createApp } from '../../src/app';
import { TranslinkQuotaModel } from '../../src/models/translink-quota.model';
import { liveFeeds } from '../../src/services/live-feeds';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { busThenWalkLegs, createLiveTrip } from '../helpers/live';
import { createTrip } from '../helpers/trips';

// Interface: GET /api/users/me/trips/:id/live, with the real database and no TransLink key (tests/setup/env.ts
// clears it), so nothing reaches TransLink and every answer is the scheduled fallback
useTestDatabase();

const app = createApp();

afterEach(() => {
  liveFeeds.reset();
});

const getLive = (tripId: string, token: string | null, query = '') => {
  const req = request(app).get(`/api/users/me/trips/${tripId}/live${query}`);
  return token === null ? req : req.set('Authorization', bearer(token));
};

describe('Unmocked: GET /api/users/me/trips/:id/live', () => {
  // Input: an active trip that rides the 99 then walks, on its first leg, with no TransLink key configured
  // Expected status code: 200
  // Expected behavior: the trip is loaded, nothing is fetched, and no request is counted against the quota
  // Expected output: { live: false, updatedAt: null, legs: [the bus leg at its scheduled times, unmatched], alerts: [] }
  test('returns scheduled times when live data is unavailable', async () => {
    const { user, token } = await createSignedInUser();
    const departAt = new Date(Date.now() + 10 * 60_000);
    const legs = busThenWalkLegs(departAt);
    const trip = await createLiveTrip(user._id, legs);

    const res = await getLive(trip._id.toHexString(), token);

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      live: false,
      updatedAt: null,
      legs: [{
        legIndex: 0,
        matched: false,
        departAt: departAt.toISOString(),
        arriveAt: legs[0]?.arriveAt?.toISOString(),
        delaySeconds: null,
        cancelled: false,
      }],
      alerts: [],
    });
    expect(await TranslinkQuotaModel.countDocuments()).toBe(0);
  });

  // Input: the same trip on leg 1 (the walk), and a driving-only active trip
  // Expected status code: 200
  // Expected behavior: no transit leg is left, so there are no legs to predict
  // Expected output: { live: false, legs: [] } for both
  test('lists no legs once the transit is done', async () => {
    const { user, token } = await createSignedInUser();
    const trip = await createLiveTrip(user._id, busThenWalkLegs(new Date()));
    const other = await createSignedInUser();
    const driving = await createTrip(other.user._id, { status: 'ACTIVE', actualStart: new Date() });

    const walking = await getLive(trip._id.toHexString(), token, '?fromLeg=1');
    const drive = await getLive(driving._id.toHexString(), other.token);

    expect(walking.status).toBe(200);
    expect(walking.body).toMatchObject({ live: false, legs: [], alerts: [] });
    expect(drive.status).toBe(200);
    expect(drive.body).toMatchObject({ live: false, legs: [], alerts: [] });
  });

  // Input: fromLeg past the last leg, negative, not a number, and repeated
  // Expected status code: 400
  // Expected behavior: nothing is polled
  // Expected output: { error: 'Invalid fromLeg' }
  test.each(['?fromLeg=2', '?fromLeg=-1', '?fromLeg=abc', '?fromLeg=0&fromLeg=1'])('rejects %s', async (query) => {
    const { user, token } = await createSignedInUser();
    const trip = await createLiveTrip(user._id, busThenWalkLegs(new Date()));

    const res = await getLive(trip._id.toHexString(), token, query);

    expect(res.status).toBe(400);
    expect(res.body).toStrictEqual({ error: 'Invalid fromLeg' });
  });

  // Input: a planned trip, and a completed one
  // Expected status code: 409
  // Expected behavior: only the active trip has live updates
  // Expected output: { error: 'Trip is not active' }
  test.each(['PLANNED', 'COMPLETED'] as const)('rejects a %s trip', async (status) => {
    const { user, token } = await createSignedInUser();
    const trip = await createLiveTrip(user._id, busThenWalkLegs(new Date()), status);

    const res = await getLive(trip._id.toHexString(), token);

    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: 'Trip is not active' });
  });

  // Input: another user's active trip, an ID no trip has, and an ID that isn't an ObjectId
  // Expected status code: 404
  // Expected behavior: another user's trip looks the same as a missing one
  // Expected output: { error: 'Trip not found' }
  test('returns 404 for a trip the user does not have', async () => {
    const { token } = await createSignedInUser();
    const owner = await createSignedInUser();
    const theirs = await createLiveTrip(owner.user._id, busThenWalkLegs(new Date()));

    for (const id of [theirs._id.toHexString(), '0123456789abcdef01234567', 'not-an-id']) {
      const res = await getLive(id, token);

      expect(res.status).toBe(404);
      expect(res.body).toStrictEqual({ error: 'Trip not found' });
    }
  });

  // Input: no Authorization header, and a token that isn't a session
  // Expected status code: 401
  // Expected behavior: the trip isn't looked up
  // Expected output: { error }
  test('requires a session', async () => {
    const { user } = await createSignedInUser();
    const trip = await createLiveTrip(user._id, busThenWalkLegs(new Date()));

    for (const token of [null, 'not-a-session']) {
      const res = await getLive(trip._id.toHexString(), token);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    }
  });
});
