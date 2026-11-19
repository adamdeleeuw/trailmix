import request from 'supertest';

import { createApp } from '../../src/app';
import { Types } from 'mongoose';
import { UserModel, type ParkingSpot } from '../../src/models/user.model';
import { env } from '../../src/config/env';
import { SessionModel } from '../../src/models/session.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { failingQuery, useTestDatabase } from '../helpers/db';
import { decodePolyline } from '../helpers/polyline';
import { rankBikeStationCandidates, SEEDED_BIKE_STATIONS } from '../../src/services/bike-station.service';

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
  for (const option of response.body.options as { legs: { mode: string; polyline: string }[] }[]) {
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

// one Google step: a walk of [seconds], or a ride on [line] (name, then short name)
function step(mode: 'WALK' | 'TRANSIT', seconds: number, line?: { name: string; nameShort?: string }): object {
  return {
    travelMode: mode,
    staticDuration: `${seconds}s`,
    distanceMeters: seconds * (mode === 'WALK' ? 1 : 8),
    polyline: { encodedPolyline: ROUTE_POLYLINE },
    startLocation: { latLng: { latitude: 49.26, longitude: -123.24 } },
    endLocation: { latLng: { latitude: 49.27, longitude: -123.2 } },
    ...(mode === 'TRANSIT'
      ? {
        transitDetails: {
          headsign: 'Downtown',
          stopDetails: { departureStop: { name: `${line?.name ?? 'Line'} stop` }, arrivalStop: { name: 'Next stop' }, stopCount: 4 },
          transitLine: { name: line?.name ?? 'Line', nameShort: line?.nameShort, color: '#00843D', vehicle: { name: 'Bus', type: 'BUS' } },
        },
      }
      : {}),
  };
}

// a detailed transit route made of [steps], timed to match the one-element MATRIX
function transitRoute(steps: object[]): object {
  return {
    routes: [{ duration: '1200s', distanceMeters: 5000, polyline: { encodedPolyline: ROUTE_POLYLINE }, legs: [{ steps }] }],
  };
}

// plans BODY (transit only) for a user with [maxWalkMinutes] saved, sending [extra] in the request
async function planWithMaxWalk(maxWalkMinutes: number, steps: object[], extra: object = {}): Promise<request.Response> {
  jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(googleSays(MATRIX))
    .mockResolvedValueOnce(googleSays(transitRoute(steps)));
  const { token } = await createSignedInUser({ maxWalkMinutes });
  return request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({ ...BODY, ...extra });
}

async function submitPlan(modes: string[] = BODY.modes, extra: object = {}): Promise<request.Response> {
  const { token } = await createSignedInUser();
  return request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({ ...BODY, ...extra, modes });
}

function stationJourney(): {
  origin: Omit<typeof BODY.origin, 'placeId'> & { placeId: string | null };
  destination: Omit<typeof BODY.destination, 'placeId'> & { placeId: string | null };
  originStations: ReturnType<typeof rankBikeStationCandidates>;
  destinationStations: ReturnType<typeof rankBikeStationCandidates>;
} {
  const waterfront = SEEDED_BIKE_STATIONS.find((station) => station.name === 'Waterfront Station');
  const broadway = SEEDED_BIKE_STATIONS.find((station) => station.name === 'Broadway-City Hall Station');
  if (waterfront === undefined || broadway === undefined) throw new Error('Station seed is missing an integration-test station');
  const origin = { label: waterfront.name, lat: waterfront.lat, lng: waterfront.lng, placeId: null };
  const destination = { label: broadway.name, lat: broadway.lat, lng: broadway.lng, placeId: null };
  return {
    origin,
    destination,
    originStations: rankBikeStationCandidates(
      { origin, destination, bikeLegEndpoint: 'ORIGIN' },
      SEEDED_BIKE_STATIONS,
      env.maxBicycleLegDistanceMeters,
      env.bikeStationCandidateCount,
    ),
    destinationStations: rankBikeStationCandidates(
      { origin, destination, bikeLegEndpoint: 'DESTINATION' },
      SEEDED_BIKE_STATIONS,
      env.maxBicycleLegDistanceMeters,
      env.bikeStationCandidateCount,
    ),
  };
}

function bicycleDetails(seconds: number, distanceMeters = 2000): object {
  return {
    routes: [{
      duration: `${seconds}s`,
      distanceMeters,
      polyline: { encodedPolyline: ROUTE_POLYLINE },
      legs: [{
        steps: [{
          travelMode: 'BICYCLE',
          staticDuration: `${seconds}s`,
          distanceMeters,
          polyline: { encodedPolyline: ROUTE_POLYLINE },
          startLocation: { latLng: { latitude: 49.28, longitude: -123.12 } },
          endLocation: { latLng: { latitude: 49.27, longitude: -123.11 } },
          navigationInstruction: { maneuver: 'STRAIGHT', instructions: 'Ride straight' },
        }],
      }],
    }],
  };
}

function transitDetails(seconds: number): object {
  return {
    routes: [{
      duration: `${seconds}s`,
      distanceMeters: 8000,
      polyline: { encodedPolyline: ROUTE_POLYLINE },
      legs: [{
        steps: [{
          travelMode: 'TRANSIT',
          staticDuration: `${seconds}s`,
          distanceMeters: 8000,
          polyline: { encodedPolyline: ROUTE_POLYLINE },
          startLocation: { latLng: { latitude: 49.28, longitude: -123.12 } },
          endLocation: { latLng: { latitude: 49.27, longitude: -123.11 } },
          transitDetails: {
            headsign: 'Waterfront',
            stopDetails: { departureStop: { name: 'Origin Station' }, arrivalStop: { name: 'Destination Station' }, stopCount: 6 },
            transitLine: { name: 'Canada Line', color: '#0067A0', vehicle: { name: 'SkyTrain', type: 'RAIL' } },
          },
        }],
      }],
    }],
  };
}

function mockBikeTransitGoogle(
  journey: ReturnType<typeof stationJourney>,
  bikeToStationSeconds: ReadonlyMap<number, number>,
  transitFromStationSeconds: ReadonlyMap<number, number>,
  transitToStationSeconds: ReadonlyMap<number, number>,
  bikeFromStationSeconds: ReadonlyMap<number, number>,
  bicycleDistanceMeters: (from: number, to: number) => number = () => 2000,
): jest.SpiedFunction<typeof fetch> {
  const originLat = journey.origin.lat;
  const destinationLat = journey.destination.lat;
  const bikeSeconds = (from: number, to: number): number => {
    if (from === originLat && to === destinationLat) return 2400;
    if (from === originLat) return bikeToStationSeconds.get(to) ?? 600;
    return bikeFromStationSeconds.get(from) ?? 600;
  };
  const transitSeconds = (from: number, to: number): number => {
    if (from === originLat && to === destinationLat) return 5000;
    if (to === destinationLat) return transitFromStationSeconds.get(from) ?? 1800;
    return transitToStationSeconds.get(to) ?? 900;
  };
  return jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const body = googleRequest(init);
    const mode = body.travelMode ?? '';
    if (body.origins !== undefined) {
      const origins = latitudes(body.origins);
      const destinations = latitudes(body.destinations);
      const seconds = mode === 'BICYCLE' ? bikeSeconds : transitSeconds;
      return Promise.resolve(googleSays(matrixOf(origins, destinations, seconds)));
    }
    const from = body.origin?.location?.latLng?.latitude ?? 0;
    const to = body.destination?.location?.latLng?.latitude ?? 0;
    return Promise.resolve(googleSays(mode === 'BICYCLE'
      ? bicycleDetails(bikeSeconds(from, to), bicycleDistanceMeters(from, to))
      : transitDetails(transitSeconds(from, to))));
  });
}

test('Plans a bicycle-only journey and keeps bicycle time out of the walking limit', async () => {
  const { token } = await createSignedInUser();
  const fetch = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(googleSays(MATRIX))
    .mockResolvedValueOnce(googleSays(bicycleDetails(900, 3000)));

  const response = await request(createApp())
    .post('/api/routes/plan')
    .set('Authorization', bearer(token))
    .send({ ...BODY, modes: ['BICYCLE'], maxWalkMinutes: 1 });

  expect(response.status).toBe(200);
  expect(response.body.options).toHaveLength(1);
  expect(response.body.options[0]).toMatchObject({
    totalDurationSeconds: 900,
    totalDistanceMeters: 3000,
    totalCostCents: 0,
    costBreakdown: { fuelCents: 0, parkingCents: 0, fareCents: 0 },
    legs: [{
      mode: 'BICYCLE',
      from: { label: BODY.origin.label, lat: BODY.origin.lat, lng: BODY.origin.lng },
      to: { label: BODY.destination.label, lat: BODY.destination.lat, lng: BODY.destination.lng },
      costCents: 0,
      distanceMeters: 3000,
      durationSeconds: 900,
      polyline: ROUTE_POLYLINE,
      transitLines: [],
    }],
  });
  expect(response.body.options[0].legs[0].departAt).toEqual(expect.any(String));
  expect(response.body.options[0].legs[0].arriveAt).toEqual(expect.any(String));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(googleRequest(fetch.mock.calls[0]?.[1]).travelMode).toBe('BICYCLE');
});

test('Drops bicycle routes whose routed distance exceeds the configured bicycle limit', async () => {
  jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(googleSays(MATRIX))
    .mockResolvedValueOnce(googleSays(bicycleDetails(900, env.maxBicycleLegDistanceMeters + 1)));

  const response = await submitPlan(['BICYCLE']);

  expect(response.status).toBe(200);
  expect(response.body.options).toEqual([]);
});

test('Plans bicycle-to-transit and prefers a farther station when its full journey is faster', async () => {
  const journey = stationJourney();
  expect(journey.originStations).toHaveLength(3);
  const bikeTimes = new Map(journey.originStations.map((station, index) => [station.lat, 120 + index * 120]));
  const transitTimes = new Map(journey.originStations.map((station, index) => [station.lat, 2000 - index * 850]));
  const fetch = mockBikeTransitGoogle(
    journey,
    bikeTimes,
    transitTimes,
    new Map(),
    new Map(),
  );
  const { token } = await createSignedInUser({
    transit: { fareType: 'ADULT_STORED_VALUE', monthlyPassZones: null },
  });

  const response = await request(createApp())
    .post('/api/routes/plan')
    .set('Authorization', bearer(token))
    .send({ origin: journey.origin, destination: journey.destination, arriveBy: null, modes: ['BICYCLE', 'TRANSIT'] });

  expect(response.status).toBe(200);
  const fastest = response.body.options.find((option: { label: string }) => option.label === 'FASTEST');
  expect(fastest.transferPoints[0].label).toBe(journey.originStations[2]?.name);
  expect(fastest.legs.map((leg: { mode: string }) => leg.mode)).toEqual(['BICYCLE', 'TRANSIT']);
  expect(fastest.legs[0].costCents).toBe(0);
  expect(fastest.legs[0]).toMatchObject({
    from: { label: journey.origin.label },
    to: { label: journey.originStations[2]?.name },
    distanceMeters: 2000,
    durationSeconds: bikeTimes.get(journey.originStations[2]?.lat ?? 0),
    polyline: ROUTE_POLYLINE,
    transitLines: [],
  });
  expect(fastest.legs[1].distanceMeters).toBeGreaterThan(0);
  expect(fastest.legs[1].durationSeconds).toBeGreaterThan(0);
  expect(fastest.legs[1].polyline).toBe(ROUTE_POLYLINE);
  expect(fastest.legs[1].costCents).toBeGreaterThan(0);
  expect(fastest.costBreakdown.fareCents).toBe(fastest.legs[1].costCents);
  expect(fastest.totalCostCents).toBe(fastest.legs.reduce((total: number, leg: { costCents: number }) => total + leg.costCents, 0));
  expect(fastest.totalDurationSeconds - fastest.legs.reduce((total: number, leg: { durationSeconds: number }) => total + leg.durationSeconds, 0))
    .toBe(env.bikeToTransitBufferSeconds);
  expect(fetch.mock.calls.every(([url]) => !String(url).includes('places.googleapis.com'))).toBe(true);
});

test('Rejects an over-limit station route and compares the remaining bicycle-transit alternatives', async () => {
  const journey = stationJourney();
  const bikeTimes = new Map(journey.originStations.map((station, index) => [station.lat, 120 + index * 120]));
  const transitTimes = new Map(journey.originStations.map((station, index) => [station.lat, [100, 1500, 1000][index] ?? 1800]));
  const rejectedStationLat = journey.originStations[0]?.lat;
  if (rejectedStationLat === undefined) throw new Error('Station fixture is missing its first candidate');
  mockBikeTransitGoogle(
    journey,
    bikeTimes,
    transitTimes,
    new Map(),
    new Map(),
    (from, to) => from === journey.origin.lat && to === rejectedStationLat
      ? env.maxBicycleLegDistanceMeters + 1
      : 2000,
  );
  const { token } = await createSignedInUser({
    transit: { fareType: 'ADULT_STORED_VALUE', monthlyPassZones: null },
  });

  const response = await request(createApp())
    .post('/api/routes/plan')
    .set('Authorization', bearer(token))
    .send({ origin: journey.origin, destination: journey.destination, arriveBy: null, modes: ['BICYCLE', 'TRANSIT'] });

  expect(response.status).toBe(200);
  expect(response.body.options.length).toBeGreaterThan(0);
  expect(response.body.options.flatMap((option: { transferPoints: { label: string }[] }) =>
    option.transferPoints.map((point) => point.label))).not.toContain(journey.originStations[0]?.name);
  const fastest = response.body.options.find((option: { label: string }) => option.label === 'FASTEST');
  expect(fastest.transferPoints[0].label).toBe(journey.originStations[2]?.name);
});

test('Plans transit-to-bicycle with the retrieval buffer and zero bicycle cost', async () => {
  const journey = stationJourney();
  expect(journey.destinationStations).toHaveLength(3);
  const transitTimes = new Map(journey.destinationStations.map((station, index) => [station.lat, 300 + index * 150]));
  const bikeTimes = new Map(journey.destinationStations.map((station, index) => [station.lat, 900 - index * 150]));
  mockBikeTransitGoogle(
    journey,
    new Map(),
    new Map(),
    transitTimes,
    bikeTimes,
  );
  const { token } = await createSignedInUser({
    transit: { fareType: 'ADULT_STORED_VALUE', monthlyPassZones: null },
  });

  const response = await request(createApp())
    .post('/api/routes/plan')
    .set('Authorization', bearer(token))
    .send({ origin: journey.origin, destination: journey.destination, arriveBy: null, modes: ['BICYCLE', 'TRANSIT'] });

  expect(response.status).toBe(200);
  const transitBike = response.body.options.find((option: { legs: { mode: string }[] }) =>
    option.legs[0]?.mode === 'TRANSIT' && option.legs[1]?.mode === 'BICYCLE');
  expect(transitBike).toBeDefined();
  expect(transitBike.transferPoints[0].label).toBe(transitBike.legs[1].from.label);
  expect(transitBike.legs[1]).toMatchObject({
    to: { label: journey.destination.label },
    distanceMeters: 2000,
    polyline: ROUTE_POLYLINE,
    transitLines: [],
  });
  expect(transitBike.legs[1].durationSeconds).toBeGreaterThan(0);
  expect(transitBike.legs[1].departAt).toEqual(expect.any(String));
  expect(transitBike.legs[1].arriveAt).toEqual(expect.any(String));
  expect(transitBike.legs[1].costCents).toBe(0);
  expect(transitBike.legs[0].costCents).toBeGreaterThan(0);
  expect(transitBike.costBreakdown.fareCents).toBe(transitBike.legs[0].costCents);
  expect(transitBike.totalDurationSeconds - transitBike.legs.reduce(
    (total: number, leg: { durationSeconds: number }) => total + leg.durationSeconds,
    0,
  )).toBe(env.transitToBikeBufferSeconds);
});

const SAVED_AT = new Date('2026-11-02T00:00:00Z');
const HOUR_SECONDS = 60 * 60;
const HOUR_MS = HOUR_SECONDS * 1000;

// a user with a car, a gas price and a fare, so every route can be priced
const DRIVER = {
  timezone: 'America/Vancouver',
  vehicle: { make: 'Honda', model: 'Civic', colour: null, litresPer100km: 8 },
  transit: { fareType: 'ADULT_STORED_VALUE' as const, monthlyPassZones: null },
  lastGasPrice: { centsPerLitre: 200, savedAt: SAVED_AT },
};

// [count] parking spots evenly spaced on the straight line from BODY's origin to its destination, cheapest first
function spotsOnTheWay(count: number): ParkingSpot[] {
  return Array.from({ length: count }, (_, index) => {
    const along = (index + 1) / (count + 1);
    return {
      _id: new Types.ObjectId(),
      label: `Spot ${index}`,
      location: {
        lat: BODY.origin.lat + (BODY.destination.lat - BODY.origin.lat) * along,
        lng: BODY.origin.lng + (BODY.destination.lng - BODY.origin.lng) * along,
      },
      placeId: `spot-${index}`,
      rateCents: 100 + index * 50,
      ratePer: 'HOUR' as const,
      overnightAllowed: true, // so an arrive-by time near midnight can't drop a spot
      createdAt: SAVED_AT,
    };
  });
}

// which of [spots] is at [latitude]
function spotIndex(spots: readonly ParkingSpot[], latitude: number): number {
  return spots.findIndex((spot) => spot.location.lat === latitude);
}

// a Google route of [seconds] with [steps], as a driving or transit route details response
function detailedRoute(seconds: number, steps: object[] = []): object {
  return {
    routes: [{
      duration: `${seconds}s`,
      distanceMeters: 10000,
      polyline: { encodedPolyline: ROUTE_POLYLINE },
      legs: [{ steps }],
    }],
  };
}

// a place in a matrix request
interface MatrixPlace {
  waypoint?: { location?: { latLng?: { latitude?: number } } };
}

// the request body Google was sent, for the matrix and route details calls the Planner makes
interface GoogleRequest {
  travelMode?: string;
  computeAlternativeRoutes?: boolean;
  origin?: { location?: { latLng?: { latitude?: number } } };
  destination?: { location?: { latLng?: { latitude?: number } } };
  origins?: MatrixPlace[]; // only matrix requests have origins
  destinations?: MatrixPlace[];
}

function googleRequest(init: { body?: unknown } | undefined): GoogleRequest {
  return JSON.parse(String(init?.body)) as GoogleRequest;
}

// the latitudes of a matrix request's origins or destinations, in the order they were sent
function latitudes(places: MatrixPlace[] | undefined): number[] {
  return (places ?? []).map((place) => place.waypoint?.location?.latLng?.latitude ?? 0);
}

// a matrix from every origin to every destination, with the time [seconds] gives each pair of latitudes;
// a pair it gives null has no route
function matrixOf(origins: number[], destinations: number[], seconds: (from: number, to: number) => number | null): object[] {
  return origins.flatMap((from, originIndex) => destinations.flatMap((to, destinationIndex) => {
    const time = seconds(from, to);
    return time === null ? [] : [routeExists(originIndex, destinationIndex, time)];
  }));
}

// a matrix element saying Google found a route of [seconds] from origin [originIndex] to destination [destinationIndex]
function routeExists(originIndex: number, destinationIndex: number, seconds: number): object {
  return { originIndex, destinationIndex, duration: `${seconds}s`, distanceMeters: 8000, condition: 'ROUTE_EXISTS' };
}

// answers the Planner's Google calls: [matrix] gives each mode's matrix from the latitudes of its origins and
// destinations, and [details] each route's details, given the mode and the latitude of the route's destination
function fakeGoogle(
  matrix: (mode: string, origins: number[], destinations: number[]) => object[],
  details: (mode: string, latitude: number) => object,
): jest.SpiedFunction<typeof fetch> {
  return jest.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
    const body = googleRequest(init);
    const mode = body.travelMode ?? '';
    if (body.origins !== undefined) {
      return Promise.resolve(googleSays(matrix(mode, latitudes(body.origins), latitudes(body.destinations))));
    }
    return Promise.resolve(googleSays(details(mode, body.destination?.location?.latLng?.latitude ?? 0)));
  });
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined); // the Planner logs one screening line per plan
});

// one of Google's alternative routes, taking [seconds], made of [steps]
function alternative(seconds: number, steps: object[]): object {
  return { duration: `${seconds}s`, distanceMeters: 5000, polyline: { encodedPolyline: ROUTE_POLYLINE }, legs: [{ steps }] };
}

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
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      const body = googleRequest(init);
      if (url.includes('computeRouteMatrix')) {
        // no direct routes: transit only from the spots, and driving only to them
        return Promise.resolve(googleSays(body.travelMode === 'DRIVE'
          ? points.map((_, destinationIndex) => ({
            originIndex: 0,
            destinationIndex,
            duration: '900s',
            distanceMeters: 10000,
            condition: 'ROUTE_EXISTS',
          }))
          : latitudes(body.origins).flatMap((latitude, originIndex) => (
            latitude === BODY.origin.lat
              ? []
              : [{
                originIndex,
                destinationIndex: 0,
                duration: '1800s',
                distanceMeters: 15000,
                condition: 'ROUTE_EXISTS',
              }]
          ))));
      }
      const spotLatitude = body.travelMode === 'DRIVE'
        ? body.destination?.location?.latLng?.latitude
        : body.origin?.location?.latLng?.latitude;
      if (body.travelMode === 'DRIVE' && spotLatitude === points[0]?.lat) return Promise.resolve(googleSays({ routes: [] }));
      const isDrive = body.travelMode === 'DRIVE';
      return Promise.resolve(googleSays({
        routes: [{
          duration: isDrive ? '900s' : '1800s',
          distanceMeters: isDrive ? 10000 : 15000,
          polyline: { encodedPolyline: ROUTE_POLYLINE },
          legs: [{
            steps: isDrive
              ? []
              : [{
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
      }));
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
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      const body = googleRequest(init);
      if (url.includes('computeRouteMatrix')) {
        // transit takes an hour from UBC and half an hour from the saved spot
        return Promise.resolve(googleSays(body.travelMode === 'DRIVE'
          ? [
            { originIndex: 0, destinationIndex: 0, duration: '900s', distanceMeters: 12000, condition: 'ROUTE_EXISTS' },
            { originIndex: 0, destinationIndex: 1, duration: '1800s', distanceMeters: 16000, condition: 'ROUTE_EXISTS' },
          ]
          : latitudes(body.origins).map((latitude, originIndex) => (latitude === BODY.origin.lat
            ? { originIndex, destinationIndex: 0, duration: '3600s', distanceMeters: 20000, condition: 'ROUTE_EXISTS' }
            : { originIndex, destinationIndex: 0, duration: '1800s', distanceMeters: 14000, condition: 'ROUTE_EXISTS' }))));
      }
      return Promise.resolve(googleSays({
        routes: [{
          duration: body.travelMode === 'DRIVE' ? '900s' : '1800s',
          distanceMeters: body.travelMode === 'DRIVE' ? 12000 : 14000,
          polyline: { encodedPolyline: ROUTE_POLYLINE },
          legs: [{
            steps: body.travelMode === 'TRANSIT'
              ? [
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
              ]
              : [],
          }],
        }],
      }));
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
    expect(response.body.options.some((option: { transferPoints: unknown[]; legs: { mode: string }[] }) =>
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
      origins: { waypoint?: { location?: { latLng?: { latitude?: number; longitude?: number } } } }[];
      destinations: { waypoint?: { location?: { latLng?: { latitude?: number; longitude?: number } } } }[];
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

  // Mocked behavior: Google returns three consecutive walking steps followed by one transit step
  // Input: valid session, UBC-to-Downtown request with TRANSIT mode
  // Expected status code: 200
  // Expected behavior: turn-by-turn walking steps normalize into one walk leg before response
  // Expected output: one labelled walk, one transit leg, and unchanged route duration and distance totals
  test('Merges consecutive walking steps in the plan response', async () => {
    const detail = {
      routes: [{
        duration: '1200s',
        distanceMeters: 5000,
        polyline: { encodedPolyline: ROUTE_POLYLINE },
        legs: [{
          steps: [
            {
              travelMode: 'WALK',
              staticDuration: '20s',
              distanceMeters: 20,
              polyline: { encodedPolyline: ROUTE_POLYLINE },
              startLocation: { latLng: { latitude: BODY.origin.lat, longitude: BODY.origin.lng } },
              endLocation: { latLng: { latitude: 49.261, longitude: -123.245 } },
            },
            {
              travelMode: 'WALK',
              staticDuration: '30s',
              distanceMeters: 30,
              polyline: { encodedPolyline: ROUTE_POLYLINE },
              startLocation: { latLng: { latitude: 49.261, longitude: -123.245 } },
              endLocation: { latLng: { latitude: 49.262, longitude: -123.244 } },
            },
            {
              travelMode: 'WALK',
              staticDuration: '40s',
              distanceMeters: 40,
              polyline: { encodedPolyline: ROUTE_POLYLINE },
              startLocation: { latLng: { latitude: 49.262, longitude: -123.244 } },
              endLocation: { latLng: { latitude: 49.263, longitude: -123.243 } },
            },
            {
              travelMode: 'TRANSIT',
              staticDuration: '1110s',
              distanceMeters: 4910,
              polyline: { encodedPolyline: ROUTE_POLYLINE },
              startLocation: { latLng: { latitude: 49.263, longitude: -123.243 } },
              endLocation: { latLng: { latitude: BODY.destination.lat, longitude: BODY.destination.lng } },
              transitDetails: {
                headsign: 'Downtown',
                stopDetails: {
                  departureStop: { name: 'UBC Exchange Bay 1' },
                  arrivalStop: { name: 'Downtown' },
                  stopCount: 8,
                },
                transitLine: { name: '99 B-Line', color: '#00843D', vehicle: { name: 'Bus', type: 'BUS' } },
              },
            },
          ],
        }],
      }],
    };
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays(MATRIX))
      .mockResolvedValueOnce(googleSays(detail));

    const response = await submitPlan();

    expect(response.status).toBe(200);
    expect(response.body.options[0]).toMatchObject({
      totalDurationSeconds: 1200,
      totalDistanceMeters: 5000,
      legs: [
        { mode: 'WALK', durationSeconds: 90, distanceMeters: 90, to: { label: 'UBC Exchange Bay 1' } },
        { mode: 'TRANSIT', durationSeconds: 1110, distanceMeters: 4910 },
      ],
    });
    expect(response.body.options[0].legs.flatMap((leg: { from: { label: string }; to: { label: string } }) =>
      [leg.from.label, leg.to.label])).not.toContain('Transit connection');
    expect(decodePolyline(response.body.options[0].legs[0].polyline as string)).toHaveLength(9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Mocked behavior: Google returns a driving route whose steps carry turn-by-turn instructions,
  //                  one with no maneuver, one with no text and one with no start location
  // Input: valid session, UBC-to-Downtown request with DRIVE mode only
  // Expected status code: 200
  // Expected behavior: the planner asks Google for the instructions and keeps those with text and a place
  // Expected output: one drive leg whose steps are the two usable instructions, the unnamed one as MANEUVER_UNSPECIFIED
  test('Returns turn-by-turn steps for a drive leg', async () => {
    const start = { latLng: { latitude: 49.27, longitude: -123.2 } };
    const driveStep = (navigationInstruction: object, startLocation: object | undefined = start) => ({
      travelMode: 'DRIVE', staticDuration: '300s', distanceMeters: 3000, polyline: { encodedPolyline: ROUTE_POLYLINE },
      startLocation, navigationInstruction,
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays(MATRIX))
      .mockResolvedValueOnce(googleSays({
        routes: [{
          duration: '900s', distanceMeters: 9000, polyline: { encodedPolyline: ROUTE_POLYLINE },
          legs: [{
            steps: [
              driveStep({ maneuver: 'DEPART', instructions: 'Head east on University Blvd' }),
              driveStep({ instructions: 'Continue onto W 10th Ave' }),
              driveStep({ maneuver: 'TURN_LEFT' }),
              driveStep({ maneuver: 'TURN_RIGHT', instructions: 'Turn right onto Burrard St' }, {}),
            ],
          }],
        }],
      }));
    const { token } = await createSignedInUser();

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token))
      .send({ ...BODY, modes: ['DRIVE'] });

    expect(response.status).toBe(200);
    expect(response.body.options[0].legs).toHaveLength(1);
    expect(response.body.options[0].legs[0].steps).toStrictEqual([
      { instruction: 'Head east on University Blvd', maneuver: 'DEPART', lat: 49.27, lng: -123.2 },
      { instruction: 'Continue onto W 10th Ave', maneuver: 'MANEUVER_UNSPECIFIED', lat: 49.27, lng: -123.2 },
    ]);
    const detailHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(detailHeaders['X-Goog-FieldMask']).toContain('routes.legs.steps.navigationInstruction');
  });

  // Mocked behavior: Google returns two walking steps with instructions, then a transit step that also has one
  // Input: valid session, UBC-to-Downtown request with TRANSIT mode
  // Expected status code: 200
  // Expected behavior: the merged walk leg keeps both walking instructions in order, and the transit leg has none
  // Expected output: a walk leg with 2 steps and a transit leg with an empty steps list
  test('Returns turn-by-turn steps for walk legs only', async () => {
    const walk = (instructions: string) => ({ ...step('WALK', 120), navigationInstruction: { maneuver: 'STRAIGHT', instructions } });
    const ride = { ...step('TRANSIT', 960), navigationInstruction: { instructions: 'Bus towards Downtown' } };
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays(MATRIX))
      .mockResolvedValueOnce(googleSays(transitRoute([walk('Head north'), walk('Walk to the stop'), ride])));

    const response = await submitPlan();

    expect(response.status).toBe(200);
    const [walkLeg, transitLeg] = response.body.options[0].legs;
    expect(walkLeg.steps.map((item: { instruction: string }) => item.instruction)).toEqual(['Head north', 'Walk to the stop']);
    expect(transitLeg.steps).toStrictEqual([]);
  });

  // Mocked behavior: Google's only route walks 6 minutes in one stretch before the bus
  // Input: valid session for a user whose saved max walk is 5 minutes, transit only
  // Expected status code: 200
  // Expected behavior: the route is dropped because one walking stretch is over the user's max
  // Expected output: { options: [], warnings: [] }
  test('Drops a route with a walking stretch longer than the saved max walk', async () => {
    const response = await planWithMaxWalk(5, [step('WALK', 360), step('TRANSIT', 840)]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ options: [], warnings: [] });
  });

  // Mocked behavior: Google's route walks 4 minutes, rides, then walks 4 more minutes (8 in total)
  // Input: valid session for a user whose saved max walk is 5 minutes, transit only
  // Expected status code: 200
  // Expected behavior: each stretch is checked on its own, so two short walks are allowed
  // Expected output: one option with both walks
  test('Keeps a route whose walking is split into stretches under the max', async () => {
    const response = await planWithMaxWalk(5, [step('WALK', 240), step('TRANSIT', 720), step('WALK', 240)]);

    expect(response.status).toBe(200);
    expect(response.body.options).toHaveLength(1);
    expect(response.body.options[0].legs.map((leg: { mode: string }) => leg.mode)).toEqual(['WALK', 'TRANSIT', 'WALK']);
  });

  // Mocked behavior: Google's only route walks 6 minutes in one stretch before the bus
  // Input: valid session for a user whose saved max walk is 5 minutes, with maxWalkMinutes 10 in the request
  // Expected status code: 200
  // Expected behavior: the request's max walk is used instead of the saved one
  // Expected output: one option
  test("Uses the request's max walk over the saved one", async () => {
    const response = await planWithMaxWalk(5, [step('WALK', 360), step('TRANSIT', 840)], { maxWalkMinutes: 10 });

    expect(response.status).toBe(200);
    expect(response.body.options).toHaveLength(1);
  });

  // Mocked behavior: Google's transit routes are, in order: one that walks 6 minutes in one stretch, one with no
  //                  geometry, a 25-minute one on the "Slow" bus and a 22-minute one on the R4
  // Input: valid session for a user whose saved max walk is 5 minutes, transit only
  // Expected status code: 200
  // Expected behavior: the planner asks Google for alternative routes, skips the first route because of its walk and
  //                    the second because it can't be parsed, and picks the shortest of the rest
  // Expected output: one option riding the R4
  test('Uses a transit alternative when the first route walks too far', async () => {
    const fetchMock = fakeGoogle(
      (_mode, origins, destinations) => matrixOf(origins, destinations, () => 1200),
      () => ({
        routes: [
          alternative(1000, [step('WALK', 360), step('TRANSIT', 640, { name: 'Walk first', nameShort: '25' })]),
          { duration: '900s' },
          alternative(1500, [step('TRANSIT', 1500, { name: 'Slow', nameShort: '9' })]),
          alternative(1320, [step('TRANSIT', 1320, { name: 'Joyce Station', nameShort: 'R4' })]),
        ],
      }),
    );
    const { token } = await createSignedInUser({ maxWalkMinutes: 5 });

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send(BODY);

    expect(response.status).toBe(200);
    expect(response.body.options).toHaveLength(1);
    expect(response.body.options[0].totalDurationSeconds).toBe(1320);
    expect(response.body.options[0].legs.flatMap((leg: { transitLines: { shortName: string }[] }) =>
      leg.transitLines.map((line) => line.shortName))).toStrictEqual(['R4']);
    const detailRequests = fetchMock.mock.calls.map(([, init]) => googleRequest(init)).filter((body) => body.origins === undefined);
    expect(detailRequests.map((body) => body.computeAlternativeRoutes)).toStrictEqual([true]);
  });

  // Mocked behavior: Google's direct transit takes 20 minutes; the drive to the first of two saved spots takes
  //                  50 minutes and to the second 5 minutes; transit from either spot takes 10 minutes
  // Input: valid session, both modes, a cost-vs-time of 50 and two saved spots on the way
  // Expected status code: 200
  // Expected behavior: even with the fastest possible ride, the chain through the first spot is slower, costlier and
  //                    scores worse than direct transit, so the planner never prices transit from it
  // Expected output: no route through the first spot; the second matrix asks only about the second spot, and the
  //                  screening log says one spot was pruned
  test('Never prices transit from a spot that cannot win', async () => {
    const spots = spotsOnTheWay(2);
    const [slowSpot, quickSpot] = spots.map((spot) => spot.location.lat);
    const { token } = await createSignedInUser({ ...DRIVER, parkingSpots: spots });
    const fetchMock = fakeGoogle(
      (mode, origins, destinations) => matrixOf(origins, destinations, (from, to) => {
        if (mode === 'DRIVE') return to === slowSpot ? 3000 : to === quickSpot ? 300 : 900;
        return from === BODY.origin.lat ? 1200 : 600;
      }),
      (mode) => (mode === 'DRIVE' ? detailedRoute(300) : transitRoute([step('TRANSIT', 1200, { name: '99' })])),
    );

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      ...BODY, modes: ['DRIVE', 'TRANSIT'], costVsTime: 50,
    });

    expect(response.status).toBe(200);
    const transitMatrices = fetchMock.mock.calls
      .map(([, init]) => googleRequest(init))
      .filter((body) => body.origins !== undefined && body.travelMode === 'TRANSIT')
      .map((body) => latitudes(body.origins));
    expect(transitMatrices).toStrictEqual([[BODY.origin.lat], [quickSpot]]);
    for (const option of response.body.options as { transferPoints: { lat: number }[] }[]) {
      expect(option.transferPoints.map((point) => point.lat)).not.toContain(slowSpot);
    }
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('2 spots, 1 pruned'));
  });

  // Mocked behavior: Google finds no drive to the first of three saved spots and no transit from the second;
  //                  every other route exists, and driving straight there is slow enough that no spot is pruned
  // Input: valid session for a user with no gas price saved, both modes and three saved spots on the way
  // Expected status code: 200
  // Expected behavior: the planner skips both spots without a route and plans through the third, pricing fuel at
  //                    the regional default
  // Expected output: the only route with a transfer point goes through the third spot, and a GAS_PRICE_MISSING warning
  test('Skips spots Google finds no drive to or transit from', async () => {
    const spots = spotsOnTheWay(3);
    const [noDrive, noTransit, reachable] = spots.map((spot) => spot.location.lat);
    const { token } = await createSignedInUser({ ...DRIVER, lastGasPrice: null, parkingSpots: spots });
    fakeGoogle(
      (mode, origins, destinations) => matrixOf(origins, destinations, (from, to) => {
        if (mode === 'DRIVE') return to === noDrive ? null : to === BODY.destination.lat ? 3000 : 600;
        return from === noTransit ? null : 1200;
      }),
      (mode) => (mode === 'DRIVE' ? detailedRoute(600) : transitRoute([step('TRANSIT', 1200, { name: '99' })])),
    );

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      ...BODY, modes: ['DRIVE', 'TRANSIT'],
    });

    expect(response.status).toBe(200);
    const transfers = (response.body.options as { transferPoints: { lat: number }[] }[])
      .flatMap((option) => option.transferPoints.map((point) => point.lat));
    expect(transfers).toStrictEqual([reachable]);
    expect(response.body.warnings).toStrictEqual(['GAS_PRICE_MISSING']);
  });

  // Mocked behavior: Google's route rides a bus, walks between stops, then rides a train
  // Input: valid session with the default max walk, transit only
  // Expected status code: 200
  // Expected behavior: changing vehicles counts as a transfer even with no parking spot, and lines keep their short names
  // Expected output: one option with transfers 1 and the bus's short name "99"
  test('Counts each vehicle change as a transfer and sends short line names', async () => {
    const response = await planWithMaxWalk(10, [
      step('TRANSIT', 600, { name: 'UBC/Commercial-Broadway', nameShort: '99' }),
      step('WALK', 120),
      step('TRANSIT', 480, { name: 'Canada Line' }),
    ]);

    expect(response.status).toBe(200);
    expect(response.body.options[0]).toMatchObject({ transfers: 1, transferPoints: [] });
    const lines = response.body.options[0].legs.flatMap((leg: { transitLines: unknown[] }) => leg.transitLines);
    expect(lines).toMatchObject([
      { name: 'UBC/Commercial-Broadway', shortName: '99' },
      { name: 'Canada Line', shortName: '' },
    ]);
  });

  // Mocked behavior: Google's transit step has its stops' locations and times, and a short walk to the stop is merged into
  //                  the ride; a second step leaves the locations and times out
  // Input: valid session with the default max walk, transit only
  // Expected status code: 200
  // Expected behavior: each line keeps its own stops' locations and scheduled times, which LiveUpdates matches to
  //                    TransLink, even though the leg starts at the walk; missing ones are null
  // Expected output: the first line with Google's locations and times, the second with nulls
  test('Sends each transit line its stop locations and scheduled times', async () => {
    const bus = step('TRANSIT', 600, { name: 'UBC/Commercial-Broadway', nameShort: '99' }) as {
      transitDetails: { stopDetails: object };
    };
    bus.transitDetails.stopDetails = {
      ...bus.transitDetails.stopDetails,
      departureStop: { name: 'UBC Exchange Bay 7', location: { latLng: { latitude: 49.2672, longitude: -123.2475 } } },
      arrivalStop: { name: 'Commercial-Broadway Station', location: { latLng: { latitude: 49.2626, longitude: -123.0691 } } },
      departureTime: '2026-11-02T16:01:00Z',
      arrivalTime: '2026-11-02T16:11:00Z',
    };

    const response = await planWithMaxWalk(10, [step('WALK', 30), bus, step('WALK', 120), step('TRANSIT', 480, { name: 'Expo Line' })]);

    expect(response.status).toBe(200);
    const lines = response.body.options[0].legs.flatMap((leg: { transitLines: unknown[] }) => leg.transitLines);
    expect(lines).toMatchObject([
      {
        shortName: '99',
        departureStopLocation: { lat: 49.2672, lng: -123.2475 },
        arrivalStopLocation: { lat: 49.2626, lng: -123.0691 },
        departAt: '2026-11-02T16:01:00.000Z',
        arriveAt: '2026-11-02T16:11:00.000Z',
      },
      { name: 'Expo Line', departureStopLocation: null, arrivalStopLocation: null, departAt: null, arriveAt: null },
    ]);
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

  // Mocked behavior: the matrix finds a route but the detailed route response is empty, as Google sends when it
  //                  finds no route
  // Input: a valid transit-only plan
  // Expected status code: 200
  // Expected behavior: omit the route when geometry/details cannot be retrieved
  // Expected output: { options: [], warnings: [] }
  test('Returns no options when a screened route has no detailed result', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays(MATRIX))
      .mockResolvedValueOnce(googleSays({}));

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

  // Mocked behavior: Google finds every route, but the direct drive's matrix element has no duration,
  //                  and the transit route has a walking step without coordinates
  // Input: valid session, both modes, one saved spot, a cost-vs-time of 80 and an arrive-by time three hours away
  // Expected status code: 200
  // Expected behavior: the chain and the transit route are scheduled back from the arrive-by time, the drive
  //                    without a duration and the step without coordinates are skipped
  // Expected output: routes with transit that all arrive at the arrive-by time, none of them late
  test('Plans backward from an arrive-by time', async () => {
    const arriveBy = new Date(Date.now() + 3 * HOUR_MS).toISOString();
    const { token } = await createSignedInUser({ ...DRIVER, parkingSpots: spotsOnTheWay(1) });
    fakeGoogle(
      (mode, origins, destinations) => (mode === 'DRIVE'
        ? [routeExists(0, 0, 600), { originIndex: 0, destinationIndex: 1, distanceMeters: 12000, condition: 'ROUTE_EXISTS' }]
        : matrixOf(origins, destinations, () => 1200)),
      (mode) => (mode === 'DRIVE'
        ? detailedRoute(600)
        : detailedRoute(1200, [
          { travelMode: 'WALK', staticDuration: '60s', distanceMeters: 60 },
          step('TRANSIT', 1140, { name: '99' }),
        ])),
    );

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      ...BODY, modes: ['DRIVE', 'TRANSIT'], arriveBy, costVsTime: 80,
    });

    expect(response.status).toBe(200);
    const options = response.body.options as { arriveAt: string; lateByMinutes: number; legs: { mode: string }[] }[];
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option.legs.some((leg) => leg.mode === 'TRANSIT')).toBe(true);
      expect(option.arriveAt).toBe(arriveBy);
      expect(option.lateByMinutes).toBe(0);
    }
  });

  // Mocked behavior: Google's direct drive takes 15 minutes and its direct transit route 20 minutes
  // Input: valid session, both modes, no saved spots, and an arrive-by time one minute away
  // Expected status code: 200
  // Expected behavior: no route arrives on time, so the planner falls back to the one that arrives earliest
  // Expected output: one drive route labelled FASTEST that says how late it is
  test('Returns the earliest route when every route is late', async () => {
    const { token } = await createSignedInUser(DRIVER);
    fakeGoogle(
      (mode) => [routeExists(0, 0, mode === 'DRIVE' ? 900 : 1200)],
      (mode) => (mode === 'DRIVE' ? detailedRoute(900) : DETAIL),
    );

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      ...BODY, modes: ['DRIVE', 'TRANSIT'], arriveBy: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(response.status).toBe(200);
    expect(response.body.options).toHaveLength(1);
    expect(response.body.options[0]).toMatchObject({ label: 'FASTEST', legs: [{ mode: 'DRIVE' }] });
    expect(response.body.options[0].lateByMinutes).toBeGreaterThan(0);
  });

  // Mocked behavior: the matrix says every chain through eight saved spots arrives on time, but the detailed drive
  //                  to the first four spots asked about takes three hours, so those chains arrive late
  // Input: valid session, both modes, eight saved spots and an arrive-by time two hours away
  // Expected status code: 200
  // Expected behavior: each late pick is replaced by the next best on-time spot for its label, skipping a
  //                    replacement that also turns out late
  // Expected output: Cheapest, Fastest and Balanced routes, all on time, none through the late spots
  test('Replaces picks that turn out late with on-time spots', async () => {
    const spots = spotsOnTheWay(8);
    const lateLatitudes = new Set<number>();
    const { token } = await createSignedInUser({ ...DRIVER, parkingSpots: spots });
    fakeGoogle(
      // no direct routes; the further along the spot, the shorter the ride
      (mode, origins, destinations) => matrixOf(origins, destinations, (from, to) => (mode === 'DRIVE'
        ? (to === BODY.destination.lat ? null : 600)
        : (from === BODY.origin.lat ? null : 1800 - spotIndex(spots, from) * 60))),
      (mode, latitude) => {
        if (mode !== 'DRIVE') return transitRoute([step('TRANSIT', 1200, { name: '99' })]);
        if (lateLatitudes.size < 4) lateLatitudes.add(latitude); // the three first picks, then the first replacement
        return detailedRoute(lateLatitudes.has(latitude) ? 3 * HOUR_SECONDS : 600);
      },
    );

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      ...BODY, modes: ['DRIVE', 'TRANSIT'], arriveBy: new Date(Date.now() + 2 * HOUR_MS).toISOString(),
    });

    expect(response.status).toBe(200);
    const options = response.body.options as { label: string; lateByMinutes: number; transferPoints: { lat: number }[] }[];
    expect(options.map((option) => option.label)).toEqual(['CHEAPEST', 'FASTEST', 'BALANCED']);
    expect(lateLatitudes.size).toBe(4);
    for (const option of options) {
      expect(option.lateByMinutes).toBe(0);
      expect(lateLatitudes.has(option.transferPoints[0]?.lat ?? 0)).toBe(false);
    }
  });

  // Mocked behavior: the matrix says the chains through three saved spots arrive on time, but every detailed
  //                  drive takes three hours, so every chain arrives late
  // Input: valid session, both modes, three saved spots and an arrive-by time two hours away
  // Expected status code: 200
  // Expected behavior: no pick or replacement arrives on time, so the planner falls back to the earliest late route
  // Expected output: one chain labelled FASTEST that says how late it is
  test('Returns the earliest late route when every pick turns out late', async () => {
    const spots = spotsOnTheWay(3);
    const { token } = await createSignedInUser({ ...DRIVER, parkingSpots: spots });
    fakeGoogle(
      // no direct routes, only chains through the spots
      (mode, origins, destinations) => matrixOf(origins, destinations, (from, to) => (mode === 'DRIVE'
        ? (to === BODY.destination.lat ? null : 600)
        : (from === BODY.origin.lat ? null : 1800))),
      (mode) => (mode === 'DRIVE' ? detailedRoute(3 * HOUR_SECONDS) : transitRoute([step('TRANSIT', 1200, { name: '99' })])),
    );

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      ...BODY, modes: ['DRIVE', 'TRANSIT'], arriveBy: new Date(Date.now() + 2 * HOUR_MS).toISOString(),
    });

    expect(response.status).toBe(200);
    expect(response.body.options).toHaveLength(1);
    expect(response.body.options[0].label).toBe('FASTEST');
    expect(response.body.options[0].transferPoints).toHaveLength(1);
    expect(response.body.options[0].lateByMinutes).toBeGreaterThan(0);
  });

  // Mocked behavior: the transit ride from the only saved spot takes 30 hours, and the direct routes are normal
  // Input: valid session, both modes, and one saved spot that doesn't allow overnight parking
  // Expected status code: 200
  // Expected behavior: the chain would leave the car parked past midnight, so the planner drops it
  // Expected output: only the direct routes, with no transfer point
  test('Drops a chain that would park overnight where it is not allowed', async () => {
    const parkingSpots = spotsOnTheWay(1).map((spot) => ({ ...spot, overnightAllowed: false }));
    const { token } = await createSignedInUser({ ...DRIVER, parkingSpots });
    fakeGoogle(
      (mode, origins, destinations) => matrixOf(origins, destinations, (from, to) => (mode === 'DRIVE'
        ? (to === BODY.destination.lat ? 900 : 600)
        : (from === BODY.origin.lat ? 1200 : 30 * HOUR_SECONDS))),
      (mode) => (mode === 'DRIVE' ? detailedRoute(900) : DETAIL),
    );

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send({
      ...BODY, modes: ['DRIVE', 'TRANSIT'],
    });

    expect(response.status).toBe(200);
    expect(response.body.options).toHaveLength(2);
    for (const option of response.body.options as { transferPoints: unknown[] }[]) {
      expect(option.transferPoints).toHaveLength(0);
    }
  });

  // Mocked behavior: Google's transit route starts and ends with walks under a minute and 50 m
  // Input: valid session, UBC-to-Downtown request with TRANSIT mode only
  // Expected status code: 200
  // Expected behavior: the first walk is merged into the ride after it, and the last into the ride before it
  // Expected output: one transit leg whose time and distance include both walks
  test('Merges short walks into the ride next to them', async () => {
    const response = await planWithMaxWalk(10, [
      step('WALK', 30),
      step('TRANSIT', 1140, { name: '99' }),
      step('WALK', 30),
    ]);

    expect(response.status).toBe(200);
    expect(response.body.options[0].legs).toHaveLength(1);
    expect(response.body.options[0].legs[0]).toMatchObject({ mode: 'TRANSIT', durationSeconds: 1200, distanceMeters: 9180 });
  });

  // Mocked behavior: Google's transit route is one SkyTrain ride from Waterfront (zone 1)
  // Input: valid session for a user with each fare type, transit only
  // Expected status code: 200
  // Expected behavior: the zones come from the SkyTrain stations, and passes cover the zones they include
  // Expected output: the fare for that fare type and number of zones
  test.each([
    ['a U-Pass', { fareType: 'UPASS', monthlyPassZones: null }, 'King George', 0],
    ['a concession monthly pass', { fareType: 'CONCESSION_MONTHLY_PASS', monthlyPassZones: null }, 'King George', 0],
    ['a 3-zone adult pass', { fareType: 'ADULT_MONTHLY_PASS', monthlyPassZones: 3 }, 'King George', 0],
    ['a 1-zone adult pass on a 3-zone trip', { fareType: 'ADULT_MONTHLY_PASS', monthlyPassZones: 1 }, 'King George', 540],
    ['concession stored value on a 2-zone trip', { fareType: 'CONCESSION_STORED_VALUE', monthlyPassZones: null }, 'Metrotown', 340],
  ] as const)('Prices a SkyTrain trip for %s', async (_name, transit, arrivalStop, fareCents) => {
    const skyTrain = {
      ...step('TRANSIT', 1200),
      transitDetails: {
        transitLine: { name: 'Expo Line', color: '#0067A0', vehicle: { name: 'SkyTrain', type: 'RAIL' } },
        stopDetails: { departureStop: { name: 'Waterfront' }, arrivalStop: { name: arrivalStop }, stopCount: 10 },
      },
    };
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleSays(MATRIX))
      .mockResolvedValueOnce(googleSays(transitRoute([skyTrain])));
    const { token } = await createSignedInUser({ transit });

    const response = await request(createApp()).post('/api/routes/plan').set('Authorization', bearer(token)).send(BODY);

    expect(response.status).toBe(200);
    expect(response.body.options[0].costBreakdown.fareCents).toBe(fareCents);
  });
});