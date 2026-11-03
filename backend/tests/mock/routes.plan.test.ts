import request from 'supertest';

import { createApp } from '../../src/app';
import { Types } from 'mongoose';
import { UserModel } from '../../src/models/user.model';
import { SessionModel } from '../../src/models/session.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { failingQuery, useTestDatabase } from '../helpers/db';
import { decodePolyline } from '../helpers/polyline';

useTestDatabase();

const BODY = {
  origin: { label: 'UBC', lat: 49.2606, lng: -123.246, placeId: 'ubc' },
  destination: { label: 'Downtown Vancouver', lat: 49.2827, lng: -123.1207, placeId: 'downtown' },
  arriveBy: null,
  modes: ['TRANSIT'],
};
const ROUTE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const MATRIX = [{ originIndex: 0, destinationIndex: 0, duration: '1200s', distanceMeters: 5000, condition: 'ROUTE_EXISTS' }];
const DETAIL = {
  routes: [{
    duration: '1200s',
    distanceMeters: 5000,
    polyline: { encodedPolyline: ROUTE_POLYLINE },
    legs: [{
      steps: [{
        travelMode: 'TRANSIT',
        staticDuration: '1200s',
        distanceMeters: 5000,
        polyline: { encodedPolyline: ROUTE_POLYLINE },
        startLocation: { latLng: { latitude: 49.2606, longitude: -123.246 } },
        endLocation: { latLng: { latitude: 49.2827, longitude: -123.1207 } },
        transitDetails: {
          headsign: 'Waterfront',
          stopDetails: { departureStop: { name: 'UBC Exchange' }, arrivalStop: { name: 'Waterfront' }, stopCount: 8 },
          transitLine: { name: '99', color: '#00843D', vehicle: { name: 'Bus', type: 'BUS' } },
        },
      }],
    }],
  }],
};

function expectEveryLegHasDecodedGeometry(response: request.Response): void {
  expect(response.body.options.length).toBeGreaterThan(0);
  for (const option of response.body.options as Array<{ legs: Array<{ mode: string; polyline: string }> }>) {
    expect(option.legs.length).toBeGreaterThan(0);
    for (const leg of option.legs) {
      expect(leg.mode).toBeTruthy();
      expect(leg.polyline.length).toBeGreaterThan(0);
      const points = decodePolyline(leg.polyline);
      expect(points.length).toBeGreaterThan(2);
    }
  }
}

function googleSays(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

async function submitPlan(): Promise<request.Response> {
  const { token } = await createSignedInUser();
  return request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send(BODY);
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface POST /api/routes/plan
describe('Mocked: POST /api/routes/plan', () => {
  // Mocked behavior: four candidates screen successfully, but the cheapest candidate has no detailed drive route
  // Input: valid session, both modes, vehicle and four saved parking spots
  // Expected status code: 200
  // Expected behavior: detail routing rejects that candidate and plans the next distinct candidate instead
  // Expected output: three labelled options with the replacement parking spot included
  test('Replaces a selected candidate with no detailed route', async () => {
    const savedAt = new Date('2026-11-02T00:00:00Z');
    const points = [0, 1, 2, 3].map((index) => ({ lat: 49.270 + index * 0.001, lng: -123.190 + index * 0.001 }));
    const parkingSpots = points.map((location, index) => ({
      _id: new Types.ObjectId(),
      label: `Transfer ${index}`,
      location,
      placeId: `replacement-${index}`,
      rateCents: 100 + index * 100,
      ratePer: 'HOUR' as const,
      overnightAllowed: true,
      createdAt: savedAt,
    }));
    const { token } = await createSignedInUser({
      timezone: 'America/Vancouver',
      vehicle: { make: 'Honda', model: 'Civic', colour: null, litresPer100km: 8 },
      transit: { fareType: 'ADULT_STORED_VALUE', monthlyPassZones: null },
      lastGasPrice: { centsPerLitre: 200, savedAt },
      parkingSpots,
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as {
        travelMode?: string;
        origin?: { location?: { latLng?: { latitude?: number } } };
        destination?: { location?: { latLng?: { latitude?: number } } };
      };
      if (url.includes('computeRouteMatrix')) {
        return googleSays(body.travelMode === 'DRIVE'
          ? points.map((_, destinationIndex) => ({
            originIndex: 0,
            destinationIndex,
            duration: '900s',
            distanceMeters: 10000,
            condition: 'ROUTE_EXISTS',
          }))
          : points.map((_, originIndex) => ({
            originIndex,
            destinationIndex: 0,
            duration: '1800s',
            distanceMeters: 15000,
            condition: 'ROUTE_EXISTS',
          })));
      }
      const spotLatitude = body.travelMode === 'DRIVE'
        ? body.destination?.location?.latLng?.latitude
        : body.origin?.location?.latLng?.latitude;
      if (body.travelMode === 'DRIVE' && spotLatitude === points[0]?.lat) return googleSays({ routes: [] });
      const isDrive = body.travelMode === 'DRIVE';
      return googleSays({
        routes: [{
          duration: isDrive ? '900s' : '1800s',
          distanceMeters: isDrive ? 10000 : 15000,
          polyline: { encodedPolyline: ROUTE_POLYLINE },
          legs: [{
            steps: isDrive ? [] : [{
              travelMode: 'TRANSIT',
              staticDuration: '1800s',
              distanceMeters: 15000,
              polyline: { encodedPolyline: ROUTE_POLYLINE },
              startLocation: { latLng: { latitude: BODY.origin.lat, longitude: BODY.origin.lng } },
              endLocation: { latLng: { latitude: BODY.destination.lat, longitude: BODY.destination.lng } },
              transitDetails: {
                transitLine: { name: '99', color: '#00843D', vehicle: { name: 'Bus', type: 'BUS' } },
                stopDetails: { departureStop: { name: 'UBC Exchange' }, arrivalStop: { name: 'Waterfront' }, stopCount: 8 },
              },
            }],
          }],
        }],
      });
    });

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      origin: BODY.origin,
      destination: BODY.destination,
      arriveBy: null,
      modes: ['DRIVE', 'TRANSIT'],
    });

    expect(response.status).toBe(200);
    expectEveryLegHasDecodedGeometry(response);
    expect(response.body.options).toHaveLength(3);
    expect(response.body.options.map((option: { label: string }) => option.label)).toEqual([
      'CHEAPEST', 'FASTEST', 'BALANCED',
    ]);
    expect(response.body.options[0].transferPoints[0].label).toBe('Transfer 3');
    expect(fetchMock).toHaveBeenCalled();
  });

  // Mocked behavior: Google returns matrix results and route details for a saved parking spot and both baselines
  // Input: valid session, both modes, a saved Vancouver spot, vehicle, gas price and transit profile
  // Expected status code: 200
  // Expected behavior: candidates include a Drive -> Transit handoff at the saved spot
  // Expected output: up to three distinct routes, including one with two legs and a transfer point
  test('Plans a saved-spot Drive-to-Transit chain and baselines', async () => {
    const spotId = new Types.ObjectId();
    const { user, token } = await createSignedInUser({
      timezone: 'America/Vancouver',
      vehicle: { make: 'Honda', model: 'Civic', colour: null, litresPer100km: 8 },
      transit: { fareType: 'ADULT_STORED_VALUE', monthlyPassZones: null },
      lastGasPrice: { centsPerLitre: 200, savedAt: new Date('2026-11-02T00:00:00Z') },
      parkingSpots: [{
        _id: spotId,
        label: 'Oakridge-41st Avenue',
        location: { lat: 49.271, lng: -123.187 },
        placeId: 'oakridge',
        rateCents: 500,
        ratePer: 'HOUR',
        overnightAllowed: true,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      }],
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as { travelMode?: string };
      if (url.includes('computeRouteMatrix')) {
        return googleSays(body.travelMode === 'DRIVE'
          ? [
            { originIndex: 0, destinationIndex: 0, duration: '900s', distanceMeters: 12000, condition: 'ROUTE_EXISTS' },
            { originIndex: 0, destinationIndex: 1, duration: '1800s', distanceMeters: 16000, condition: 'ROUTE_EXISTS' },
          ]
          : [
            { originIndex: 0, destinationIndex: 0, duration: '1800s', distanceMeters: 14000, condition: 'ROUTE_EXISTS' },
            { originIndex: 1, destinationIndex: 0, duration: '3600s', distanceMeters: 20000, condition: 'ROUTE_EXISTS' },
          ]);
      }
      return googleSays({
        routes: [{
          duration: body.travelMode === 'DRIVE' ? '900s' : '1800s',
          distanceMeters: body.travelMode === 'DRIVE' ? 12000 : 14000,
          polyline: { encodedPolyline: ROUTE_POLYLINE },
          legs: [{
            steps: body.travelMode === 'TRANSIT' ? [
              {
                travelMode: 'WALK',
                staticDuration: '120s',
                distanceMeters: 100,
                polyline: { encodedPolyline: ROUTE_POLYLINE },
                startLocation: { latLng: { latitude: 49.271, longitude: -123.187 } },
                endLocation: { latLng: { latitude: 49.272, longitude: -123.186 } },
              },
              {
                travelMode: 'TRANSIT',
                staticDuration: '1680s',
                distanceMeters: 13900,
                polyline: { encodedPolyline: ROUTE_POLYLINE },
                startLocation: { latLng: { latitude: 49.272, longitude: -123.186 } },
                endLocation: { latLng: { latitude: 49.285, longitude: -123.111 } },
                transitDetails: {
                  headsign: 'Waterfront',
                  stopDetails: { departureStop: { name: 'Oakridge-41st Avenue' }, arrivalStop: { name: 'Waterfront' }, stopCount: 6 },
                  transitLine: { name: 'Canada Line', color: '#0067A0', vehicle: { name: 'SkyTrain', type: 'RAIL' } },
                },
              },
            ] : [],
          }],
        }],
      });
    });

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      origin: BODY.origin,
      destination: BODY.destination,
      arriveBy: null,
      modes: ['DRIVE', 'TRANSIT'],
    });

    expect(response.status).toBe(200);
    expectEveryLegHasDecodedGeometry(response);
    expect(response.body.options).toHaveLength(3);
    expect(response.body.options.some((option: { transferPoints: unknown[]; legs: Array<{ mode: string }> }) =>
      option.transferPoints.length === 1 && option.legs.length === 3 && option.legs[1]?.mode === 'WALK')).toBe(true);
    expect(response.body.options.map((option: { label: string }) => option.label)).toEqual([
      'CHEAPEST', 'FASTEST', 'BALANCED',
    ]);
    expect(fetchMock).toHaveBeenCalled();
    expect(await UserModel.findById(user._id).lean()).not.toBeNull();
  });

  // Mocked behavior: Google returns one transit matrix result and one detailed route
  // Input: valid session, Vancouver origin and destination, transit mode, leave now
  // Expected status code: 200
  // Expected behavior: the baseline is priced and returned with Google geometry and line details
  // Expected output: one CHEAPEST option and no warnings
  test('Plans a transit-only baseline', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays(MATRIX))
      .mockResolvedValueOnce(googleSays(DETAIL));

    const response = await submitPlan();
    const matrixRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      origins: Array<{ waypoint?: { location?: { latLng?: { latitude?: number; longitude?: number } } } }>;
      destinations: Array<{ waypoint?: { location?: { latLng?: { latitude?: number; longitude?: number } } } }>;
    };

    expect(response.status).toBe(200);
    expect(matrixRequest.origins[0]?.waypoint?.location?.latLng).toEqual({ latitude: BODY.origin.lat, longitude: BODY.origin.lng });
    expect(matrixRequest.destinations[0]?.waypoint?.location?.latLng).toEqual({
      latitude: BODY.destination.lat,
      longitude: BODY.destination.lng,
    });
    expect(response.body.warnings).toEqual([]);
    expect(response.body.options).toHaveLength(1);
    expect(response.body.options[0]).toMatchObject({
      label: 'CHEAPEST',
      totalDistanceMeters: 5000,
      totalDurationSeconds: 1200,
      transferPoints: [],
      transfers: 0,
      legs: [{ mode: 'TRANSIT', polyline: ROUTE_POLYLINE, transitLines: [{ name: '99', colour: '#00843D', headsign: 'Waterfront' }] }],
    });
    expectEveryLegHasDecodedGeometry(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Mocked behavior: Google fails the first matrix request and succeeds on retry
  // Input: a valid transit-only plan
  // Expected status code: 200
  // Expected behavior: exactly one retry occurs before the detail request
  // Expected output: a successful route response
  test('Retries a transient Google error once', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays({}, 503))
      .mockResolvedValueOnce(googleSays(MATRIX))
      .mockResolvedValueOnce(googleSays(DETAIL));

    const response = await submitPlan();

    expect(response.status).toBe(200);
    expectEveryLegHasDecodedGeometry(response);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // Mocked behavior: Google fails both attempts to fetch a matrix
  // Input: a valid transit-only plan
  // Expected status code: 503
  // Expected behavior: stop after one retry
  // Expected output: { error: "Couldn't reach the route service" }
  test('Returns 503 after Google fails twice', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays({}, 503))
      .mockResolvedValueOnce(googleSays({}, 503));

    const response = await submitPlan();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Couldn't reach the route service" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Mocked behavior: both Google calls reject with a timeout error
  // Input: a valid transit-only plan
  // Expected status code: 503
  // Expected behavior: abort each timed-out attempt and retry once
  // Expected output: { error: "Couldn't reach the route service" }
  test('Returns 503 after the route service times out twice', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));

    const response = await submitPlan();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Couldn't reach the route service" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Mocked behavior: the matrix has no route element
  // Input: a valid transit-only plan in an unreachable area
  // Expected status code: 200
  // Expected behavior: omit the candidate and do not request route details
  // Expected output: { options: [], warnings: [] }
  test('Returns an empty options list when Google finds no route', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(googleSays([]));

    const response = await submitPlan();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ options: [], warnings: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Mocked behavior: the matrix finds a route but the detailed route response has no route
  // Input: a valid transit-only plan
  // Expected status code: 200
  // Expected behavior: omit the route when geometry/details cannot be retrieved
  // Expected output: { options: [], warnings: [] }
  test('Returns no options when a screened route has no detailed result', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays(MATRIX))
      .mockResolvedValueOnce(googleSays({ routes: [] }));

    const response = await submitPlan();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ options: [], warnings: [] });
  });

  // Mocked behavior: session user lookup succeeds but fetching the user's saved spots fails
  // Input: a valid Drive -> Transit request with a valid session
  // Expected status code: 500
  // Expected behavior: do not contact Google after the database failure
  // Expected output: { error: "Internal Server Error" }
  test('Handles a database error while loading parking spots', async () => {
    const { user, token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findById')
      .mockReturnValueOnce({ lean: () => Promise.resolve(user) } as never)
      .mockReturnValueOnce(failingQuery());
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      ...BODY,
      modes: ['DRIVE', 'TRANSIT'],
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mocked behavior: the database fails during session lookup
  // Input: an otherwise valid planner request
  // Expected status code: 500
  // Expected behavior: no route service request is made
  // Expected output: { error: "Internal Server Error" }
  test('Handles a database error', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(SessionModel, 'findOne').mockReturnValueOnce(failingQuery());
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send(BODY);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});