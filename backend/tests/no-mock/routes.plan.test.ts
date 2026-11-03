import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { decodePolyline } from '../helpers/polyline';

useTestDatabase();

const origin = { label: 'UBC', lat: 49.2606, lng: -123.246, placeId: 'ubc' };
const destination = { label: 'Downtown Vancouver', lat: 49.2827, lng: -123.1207, placeId: 'downtown' };
const validBody = { origin, destination, arriveBy: null, modes: ['TRANSIT'] };

function sendPlan(body: object | undefined, authorization?: string): request.Test {
  const test = request(createApp()).post('/api/routes/plan');
  if (authorization !== undefined) test.set('Authorization', authorization);
  return test.send(body);
}

const liveRouteGeometryTest =
  process.env.RUN_LIVE_ROUTE_GEOMETRY_TESTS === 'true' &&
  process.env.GOOGLE_ROUTES_API_KEY !== undefined &&
  process.env.GOOGLE_ROUTES_API_KEY !== 'test-routes-api-key'
    ? test
    : test.skip;

// Interface POST /api/routes/plan
describe('Unmocked: POST /api/routes/plan', () => {
  // Input: valid body without a session
  // Expected status code: 401
  // Expected behavior: reject before validating or calling Google
  // Expected output: { error: "Unauthorized" }
  test('Rejects a missing session', async () => {
    const response = await sendPlan(validBody);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  // Input: valid session and request bodies with a missing place, invalid coordinate, unknown mode, invalid preference,
  // a max walk outside 1 to 60 whole minutes, or invalid date
  // Expected status code: 400
  // Expected behavior: reject each request before contacting Google
  // Expected output: a field-specific error message
  test('Rejects invalid request fields', async () => {
    const { token } = await createSignedInUser();
    const badBodies = [
      [{ ...validBody, origin: undefined }, 'origin'],
      [{ ...validBody, destination: { ...destination, lat: 91 } }, 'destination'],
      [{ ...validBody, modes: ['BIKE'] }, 'modes'],
      [{ ...validBody, costVsTime: 101 }, 'costVsTime'],
      [{ ...validBody, maxWalkMinutes: 0 }, 'maxWalkMinutes'],
      [{ ...validBody, maxWalkMinutes: 7.5 }, 'maxWalkMinutes'],
      [{ ...validBody, arriveBy: 'tomorrow afternoon' }, 'arriveBy'],
    ] as const;

    for (const [body, field] of badBodies) {
      const response = await sendPlan(body, bearer(token));
      expect(response.status).toBe(400);
      expect(response.body.error).toContain(field);
    }
  });

  // Mocked behavior: none; MongoDB and Google Routes API are real
  // Input: valid session, UBC-to-Downtown request with DRIVE and TRANSIT modes
  // Expected status code: 200
  // Expected behavior: fetch live route details without stubbing the route service
  // Expected output: every returned leg has a non-empty polyline decoding to more than two points
  liveRouteGeometryTest('Returns decoded geometry for every live route leg', async () => {
    const { token } = await createSignedInUser();
    const response = await sendPlan({ ...validBody, modes: ['DRIVE', 'TRANSIT'] }, bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.options.length).toBeGreaterThan(0);
    for (const option of response.body.options as Array<{
      legs: Array<{ mode: string; polyline: string; from: { label: string }; to: { label: string } }>;
    }>) {
      expect(option.legs.length).toBeGreaterThan(0);
      for (const leg of option.legs) {
        expect(leg.mode).toBeTruthy();
        expect(leg.polyline.length).toBeGreaterThan(0);
        const points = decodePolyline(leg.polyline);
        expect(points.length).toBeGreaterThan(2);
        expect(leg.from.label).not.toBe('Transit connection');
        expect(leg.to.label).not.toBe('Transit connection');
      }
      for (let index = 1; index < option.legs.length; index += 1) {
        expect(option.legs[index - 1]?.mode === 'WALK' && option.legs[index]?.mode === 'WALK').toBe(false);
      }
    }
  }, 30_000);
});