// Unmocked tests: nothing is faked. These requests get rejected before our server calls Google,
// so no fake Google is needed and no real API calls are spent.
import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase(); // fresh test database, emptied after every test

const POINT = { lat: 49.2827, lng: -123.1207 }; // a real spot in Vancouver
const VALID_BODY = { start: POINT, split: POINT, destination: POINT };

// Sends a request to our endpoint. Pass a token to be signed in, or leave it out to be signed out.
// Pass undefined as the body to send no body at all.
async function planRoute(body: object | undefined, token?: string): Promise<request.Response> {
  const req = request(createApp()).post('/api/routes/chained');
  if (token !== undefined) {
    req.set('Authorization', bearer(token)); // the "wristband": "Bearer <token>"
  }
  return body === undefined ? req : req.send(body);
}

// Interface POST /api/routes/chained
describe('Unmocked: POST /api/routes/chained', () => {
  // Input: valid { start, split, destination } with no session, or a fake session token
  // Expected status code: 401
  // Expected behavior: request is rejected before any route is planned
  // Expected output: { error: "Unauthorized" }
  test('Not signed in', async () => {
    // Good points, but no wristband, then a made-up one. requireSession should turn both away.
    const responses = [await planRoute(VALID_BODY), await planRoute(VALID_BODY, 'fake-token')];

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    }
  });

  // Input: valid session; a body that is missing a point, or has a point that isn't a real { lat, lng }
  // Expected status code: 400
  // Expected behavior: request is rejected before any route is planned
  // Expected output: { error: "start, split and destination must each be { lat, lng }" }
  test('Missing or invalid points', async () => {
    const { token } = await createSignedInUser(); // signed in, so only the points can be the problem

    // Each body breaks a different check in parsePoint (routes.controller.ts)
    const badBodies = [
      undefined, // no body at all
      { start: null, split: POINT, destination: POINT },
      { start: POINT, split: 'Bridgeport Station', destination: POINT }, // a name, not coordinates
      { start: POINT, split: POINT }, // no destination
      { ...VALID_BODY, start: { lat: '49.28', lng: -123.12 } }, // lat is text, not a number
      { ...VALID_BODY, start: { lat: 49.28 } }, // no lng
      { ...VALID_BODY, start: { lat: 91, lng: -123.12 } }, // no such latitude
      { ...VALID_BODY, start: { lat: 49.28, lng: -181 } }, // no such longitude
    ];

    // Send each one; every single one should get a 400 with the same error
    for (const body of badBodies) {
      const response = await planRoute(body, token);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'start, split and destination must each be { lat, lng }' });
    }
  });
});