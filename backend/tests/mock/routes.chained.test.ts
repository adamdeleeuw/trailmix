// Mocked tests: Google is fake here, so we choose what it answers.
import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase(); // fresh test database, emptied after every test

const POINT = { lat: 49.2827, lng: -123.1207 }; // any spot works, Google is fake
const BODY = { start: POINT, split: POINT, destination: POINT };

// What Google sends back for one route ("669s" = 669 seconds)
const DRIVE_ROUTE = { duration: '669s', distanceMeters: 4076, polyline: { encodedPolyline: 'drive-line' } };
const TRANSIT_ROUTE = { duration: '1340s', distanceMeters: 11222, polyline: { encodedPolyline: 'transit-line' } };

// Fake Google: 1st call gets driveAnswer, 2nd gets transitAnswer (our server asks drive first)
function fakeGoogle(driveAnswer: Response, transitAnswer: Response): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(driveAnswer).mockResolvedValueOnce(transitAnswer);
}

// A normal "200 OK" answer from Google
function googleSays(body: object): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

// Signs in a test user and sends BODY to our endpoint, like the phone does
async function planRoute(): Promise<request.Response> {
  const { token } = await createSignedInUser();
  return request(createApp()).post('/api/routes/chained').set('Authorization', bearer(token)).send(BODY);
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined); // hide expected error logs
});

afterEach(() => {
  jest.restoreAllMocks(); // undo the fakes so the next test starts clean
});

// Interface POST /api/routes/chained
describe('Mocked: POST /api/routes/chained', () => {
  // Mocked behavior: Google finds a driving route and a transit route
  // Input: valid session; valid { start, split, destination }
  // Expected status code: 200
  // Expected behavior: Google is asked for both legs
  // Expected output: { legs: [driveLeg, transitLeg], totalDurationSeconds }
  test('Google finds both legs', async () => {
    const fetchMock = fakeGoogle(googleSays({ routes: [DRIVE_ROUTE] }), googleSays({ routes: [TRANSIT_ROUTE] }));

    const response = await planRoute();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      legs: [
        { mode: 'DRIVE', durationSeconds: 669, distanceMeters: 4076, polyline: 'drive-line' },
        { mode: 'TRANSIT', durationSeconds: 1340, distanceMeters: 11222, polyline: 'transit-line' },
      ],
      totalDurationSeconds: 2009, // 669 + 1340
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // once per leg
  });

  // Mocked behavior: Google finds a driving route but answers {} for transit (no transit runs there)
  // Input: valid session; valid { start, split, destination }
  // Expected status code: 404
  // Expected behavior: no partial route is returned
  // Expected output: { error: "No route found" }
  test('Google finds no transit route', async () => {
    fakeGoogle(googleSays({ routes: [DRIVE_ROUTE] }), googleSays({})); // {} = Google's "no route"

    const response = await planRoute();

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'No route found' });
  });

  // Mocked behavior: Google leaves out a leg's distance (e.g. start and split are the same point)
  // Input: valid session; valid { start, split, destination }
  // Expected status code: 200
  // Expected behavior: the missing distance is treated as 0
  // Expected output: the drive leg has distanceMeters 0
  test('Google leaves out a distance', async () => {
    const driveWithNoDistance = { duration: DRIVE_ROUTE.duration, polyline: DRIVE_ROUTE.polyline }; // no distanceMeters
    fakeGoogle(googleSays({ routes: [driveWithNoDistance] }), googleSays({ routes: [TRANSIT_ROUTE] }));

    const response = await planRoute();

    expect(response.status).toBe(200);
    expect(response.body.legs[0].distanceMeters).toBe(0); // the `?? 0` in routes.service.ts
  });

  // Mocked behavior: Google rejects the request (e.g. a bad API key)
  // Input: valid session; valid { start, split, destination }
  // Expected status code: 500
  // Expected behavior: error is handled without crashing
  // Expected output: { error: "Internal Server Error" }
  test('Google responds with an error', async () => {
    fakeGoogle(new Response('{}', { status: 403 }), googleSays({ routes: [TRANSIT_ROUTE] })); // 403 = bad key

    const response = await planRoute();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
  });
});