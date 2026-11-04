import request from 'supertest';

import { createApp } from '../../src/app';
import { TripModel } from '../../src/models/trip.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { BURNABY_HOME, DOWNTOWN, DRIVE_LEG, ROUTE_OPTION, TRANSIT_LEG, createTrip, tripBody } from '../helpers/trips';

useTestDatabase();

const PATH = '/api/users/me/trips';
const MINUTE_MS = 60 * 1000;
const TOO_LONG_TEXT = 'x'.repeat(513); // one more than the 512 allowed
const [EXPO_LINE] = TRANSIT_LEG.transitLines;

/** A body whose route has these fields changed. */
const withOption = (fields: Record<string, unknown>) => tripBody({ option: { ...ROUTE_OPTION, ...fields } });

/** A body whose route's drive leg is replaced by `leg`. */
const withDriveLeg = (leg: unknown) => withOption({ legs: [leg, ...ROUTE_OPTION.legs.slice(1)] });

/** A body whose route's SkyTrain leg rides `lines`, with every total still adding up. */
const withTransitLines = (lines: unknown[]) =>
  withOption({ legs: ROUTE_OPTION.legs.map((leg) => (leg === TRANSIT_LEG ? { ...TRANSIT_LEG, transitLines: lines } : leg)) });

/** A body whose route's SkyTrain leg rides one line with these fields changed. */
const withLine = (fields: Record<string, unknown>) => withTransitLines([{ ...EXPO_LINE, ...fields }]);

/** Sends a body as the given user, expects a 400, and checks nothing was saved. */
async function expectRejected(token: string, body: object): Promise<void> {
  const response = await request(createApp()).post(PATH).set('Authorization', bearer(token)).send(body);

  expect(response.status).toBe(400);
  expect(response.body).toStrictEqual({ error: 'Invalid trip' });
  expect(await TripModel.countDocuments()).toBe(0);
}

// Interface POST /api/users/me/trips
describe('Unmocked: POST /api/users/me/trips', () => {
  // Input: a valid session and Save for later on a Drive → Walk → Transit → Walk route, with
  //        label, lateByMinutes, transfers and another user's userId also sent
  // Expected status code: 201
  // Expected behavior: the trip is saved as PLANNED for the signed-in user only, origin and
  //                    destination come from the first and last legs, and the extra fields are ignored
  // Expected output: { trip } with every stored field, tripDate equal to leaveAt, and no actual times
  test('Valid PLANNED trip is saved and returned', async () => {
    const { user, token } = await createSignedInUser();
    const { user: other } = await createSignedInUser();

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token))
      .send(tripBody({ userId: other._id.toString() }));

    expect(response.status).toBe(201);
    expect(response.body).toStrictEqual({
      trip: {
        id: expect.any(String),
        status: 'PLANNED',
        origin: BURNABY_HOME,
        destination: DOWNTOWN,
        transferPoints: ROUTE_OPTION.transferPoints,
        legs: ROUTE_OPTION.legs,
        totalDurationSeconds: ROUTE_OPTION.totalDurationSeconds,
        totalDistanceMeters: ROUTE_OPTION.totalDistanceMeters,
        totalCostCents: ROUTE_OPTION.totalCostCents,
        costBreakdown: ROUTE_OPTION.costBreakdown,
        costEstimated: false,
        baselineDriveCostCents: ROUTE_OPTION.baselineDriveCostCents,
        arriveBy: '2026-11-03T16:30:00.000Z',
        plannedStart: ROUTE_OPTION.leaveAt,
        plannedEnd: ROUTE_OPTION.arriveAt,
        actualStart: null,
        actualEnd: null,
        tripDate: ROUTE_OPTION.leaveAt,
      },
    });
    const stored = await TripModel.findById(response.body.trip.id).lean();
    expect(stored?.userId.toString()).toBe(user._id.toString());
    expect(stored?.seeded).toBe(false);
  });

  // Input: a valid session and Start on a route, with actualStart from the app 1 minute ago
  // Expected status code: 201
  // Expected behavior: the trip is saved as ACTIVE, started at the app's time
  // Expected output: { trip } with status ACTIVE, and actualStart and tripDate set to the app's time
  test('Valid ACTIVE trip is saved with the app start time', async () => {
    const { token } = await createSignedInUser();
    const actualStart = new Date(Date.now() - MINUTE_MS).toISOString();

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token))
      .send(tripBody({ status: 'ACTIVE', actualStart }));

    expect(response.status).toBe(201);
    expect(response.body.trip).toMatchObject({ status: 'ACTIVE', actualStart, tripDate: actualStart, actualEnd: null });
  });

  // Input: a valid session and Start on a route, with no actualStart and no arriveBy
  // Expected status code: 201
  // Expected behavior: the trip starts now, and has no arrive-by time ("leave now")
  // Expected output: { trip } with actualStart set to the server's current time and arriveBy null
  test('ACTIVE trip without a start time starts now', async () => {
    const { token } = await createSignedInUser();
    const before = Date.now();

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token))
      .send(tripBody({ status: 'ACTIVE', arriveBy: null }));

    expect(response.status).toBe(201);
    expect(response.body.trip.arriveBy).toBeNull();
    const startedAt = Date.parse(String(response.body.trip.actualStart));
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(Date.now());
  });

  // Input: a valid session and a PLANNED trip with an actualStart
  // Expected status code: 201
  // Expected behavior: a planned trip hasn't started, so the start time is ignored
  // Expected output: { trip } with status PLANNED and actualStart null
  test('PLANNED trip ignores a start time', async () => {
    const { token } = await createSignedInUser();

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token))
      .send(tripBody({ actualStart: new Date().toISOString() }));

    expect(response.status).toBe(201);
    expect(response.body.trip).toMatchObject({ status: 'PLANNED', actualStart: null });
  });

  // Input: a valid session and a route whose totalCostCents (756) is 1 more than its legs and breakdown
  // Expected status code: 400
  // Expected behavior: the trip model refuses it, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test("Totals that don't add up are rejected", async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, totalCostCents: 756 } }));
  });

  // Input: a valid session and a route whose cost breakdown adds up to 754, not its 755 total
  // Expected status code: 400
  // Expected behavior: the trip model refuses it, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test("Cost breakdown that doesn't add up is rejected", async () => {
    const { token } = await createSignedInUser();
    const costBreakdown = { fuelCents: 119, parkingCents: 300, fareCents: 335 };
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, costBreakdown } }));
  });

  // Input: a valid session and a route whose totalDistanceMeters is 1 more than its legs
  // Expected status code: 400
  // Expected behavior: the trip model refuses it, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test("Distance that doesn't add up is rejected", async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, totalDistanceMeters: 23651 } }));
  });

  // Input: a valid session and a route whose totalDurationSeconds is 1 more than its legs
  // Expected status code: 400
  // Expected behavior: the trip model refuses it, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test("Duration that doesn't add up is rejected", async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, totalDurationSeconds: 2821 } }));
  });

  // Input: a valid session and status "PAUSED", then status { "$ne": null } (a NoSQL injection attempt)
  // Expected status code: 400
  // Expected behavior: only PLANNED and ACTIVE are accepted, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Unknown status is rejected', async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, tripBody({ status: 'PAUSED' }));
    await expectRejected(token, tripBody({ status: { $ne: null } }));
  });

  // Input: a valid session and status COMPLETED
  // Expected status code: 400
  // Expected behavior: a trip can't be saved already finished, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('COMPLETED on create is rejected', async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, tripBody({ status: 'COMPLETED' }));
  });

  // Input: a valid session and a route with no legs field, then with an empty legs list
  // Expected status code: 400
  // Expected behavior: a trip needs at least one leg, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Missing legs are rejected', async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, legs: undefined } })); // undefined fields aren't sent
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, legs: [] } }));
  });

  // Input: a valid session and a route with 9 legs, one more than the 8 allowed
  // Expected status code: 400
  // Expected behavior: the list is refused before its legs are read, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Too many legs are rejected', async () => {
    const { token } = await createSignedInUser();
    const legs = Array.from({ length: 9 }, () => DRIVE_LEG);
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, legs } }));
  });

  // Input: a valid session and a leg with mode BIKE, then a leg with a latitude of 91
  // Expected status code: 400
  // Expected behavior: legs must use a known mode and real coordinates, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Invalid leg is rejected', async () => {
    const { token } = await createSignedInUser();
    const [, ...rest] = ROUTE_OPTION.legs;
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, legs: [{ ...DRIVE_LEG, mode: 'BIKE' }, ...rest] } }));
    const badPlace = { ...BURNABY_HOME, lat: 91 };
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, legs: [{ ...DRIVE_LEG, from: badPlace }, ...rest] } }));
  });

  // Input: a valid session and a route whose leaveAt has no timezone, then one arriving before it leaves
  // Expected status code: 400
  // Expected behavior: times must be ISO 8601 with a timezone and in order, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Invalid route times are rejected', async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, leaveAt: '2026-11-03T15:30:00' } }));
    await expectRejected(token, tripBody({ option: { ...ROUTE_OPTION, arriveAt: '2026-11-03T15:00:00.000Z' } }));
  });

  // Input: a valid session and an ACTIVE trip whose actualStart is 10 minutes in the future
  // Expected status code: 400
  // Expected behavior: a start more than 5 minutes ahead of the server is refused, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Start time in the future is rejected', async () => {
    const { token } = await createSignedInUser();
    const actualStart = new Date(Date.now() + 10 * MINUTE_MS).toISOString();
    await expectRejected(token, tripBody({ status: 'ACTIVE', actualStart }));
  });

  // Input: a valid session for a user who already has an ACTIVE trip, and Start on another route
  // Expected status code: 409
  // Expected behavior: the second trip isn't saved, so the user still has one ACTIVE trip
  // Expected output: { error: "Another trip is already active" }
  test('Starting a second ACTIVE trip is rejected', async () => {
    const { user, token } = await createSignedInUser();
    await createTrip(user._id, { status: 'ACTIVE', actualStart: new Date() });

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token))
      .send(tripBody({ status: 'ACTIVE' }));

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'Another trip is already active' });
    expect(await TripModel.countDocuments({ userId: user._id })).toBe(1);
  });

  // Input: a valid session for a user whose trip is ACTIVE, while another user starts a trip
  // Expected status code: 201
  // Expected behavior: the one-ACTIVE-trip rule is per user, so the other user's trip is saved
  // Expected output: { trip } with status ACTIVE
  test("Another user's ACTIVE trip doesn't block mine", async () => {
    const { user: other } = await createSignedInUser();
    const { token } = await createSignedInUser();
    await createTrip(other._id, { status: 'ACTIVE', actualStart: new Date() });

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token))
      .send(tripBody({ status: 'ACTIVE' }));

    expect(response.status).toBe(201);
    expect(response.body.trip.status).toBe('ACTIVE');
  });

  // Input: a valid session and a route where the optional fields are null or left out: no stop count,
  //        colour or headsign, a null baseline drive cost, a place with no placeId, and a null actualStart
  // Expected status code: 201
  // Expected behavior: Google may leave these out, so the trip is saved, with null for each, and starts now
  // Expected output: { trip } with those fields null and actualStart set
  test('Optional fields may be null or left out', async () => {
    const { token } = await createSignedInUser();
    const line = { ...EXPO_LINE, stopCount: undefined, colour: undefined, headsign: null }; // undefined fields aren't sent
    const legs = [{ ...DRIVE_LEG, from: { ...BURNABY_HOME, placeId: undefined } }, ...ROUTE_OPTION.legs.slice(1)]
      .map((leg) => (leg === TRANSIT_LEG ? { ...TRANSIT_LEG, transitLines: [line] } : leg));

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token))
      .send(tripBody({ option: { ...ROUTE_OPTION, legs, baselineDriveCostCents: null }, status: 'ACTIVE', actualStart: null }));

    expect(response.status).toBe(201);
    expect(response.body.trip.legs[2].transitLines).toStrictEqual([
      { ...EXPO_LINE, colour: null, headsign: null, stopCount: null },
    ]);
    expect(response.body.trip.origin.placeId).toBeNull();
    expect(response.body.trip.baselineDriveCostCents).toBeNull();
    expect(response.body.trip.actualStart).not.toBeNull();
  });

  // Input: a valid session, and a body that is a list, then an option that is a string
  // Expected status code: 400
  // Expected behavior: the body and the route must be objects, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Body or route that is not an object is rejected', async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, [tripBody()]);
    await expectRejected(token, tripBody({ option: 'CHEAPEST' }));
  });

  // Input: a valid session, and a place that isn't an object, has an empty, long or missing label,
  //        a placeId that is a number or too long, or a longitude of 181
  // Expected status code: 400
  // Expected behavior: places must have a name and real coordinates, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Invalid places are rejected', async () => {
    const { token } = await createSignedInUser();
    const badPlaces = [
      'Home', { ...BURNABY_HOME, label: '' }, { ...BURNABY_HOME, label: TOO_LONG_TEXT }, { ...BURNABY_HOME, label: 7 },
      { ...BURNABY_HOME, placeId: 7 }, { ...BURNABY_HOME, placeId: TOO_LONG_TEXT }, { ...BURNABY_HOME, lng: 181 },
    ];
    for (const place of badPlaces) {
      await expectRejected(token, withDriveLeg({ ...DRIVE_LEG, from: place }));
    }
    await expectRejected(token, withDriveLeg({ ...DRIVE_LEG, to: 'Work' }));
    await expectRejected(token, withOption({ transferPoints: [{ ...BURNABY_HOME, lat: -91 }] }));
    await expectRejected(token, withOption({ transferPoints: 'Production Way lot' }));
  });

  // Input: a valid session, and a leg that isn't an object, or has a bad time, a negative, fractional
  //        or text count, a polyline that is missing, empty or over 20000 characters, or transit lines
  //        that aren't a list or number more than 5
  // Expected status code: 400
  // Expected behavior: every leg field is checked, long lists are refused unread, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Invalid leg fields are rejected', async () => {
    const { token } = await createSignedInUser();
    const badLegs = [
      'DRIVE', { ...DRIVE_LEG, departAt: 'soon' }, { ...DRIVE_LEG, arriveAt: null },
      { ...DRIVE_LEG, durationSeconds: -1 }, { ...DRIVE_LEG, distanceMeters: 1.5 }, { ...DRIVE_LEG, costCents: '420' },
      { ...DRIVE_LEG, polyline: undefined }, { ...DRIVE_LEG, polyline: '' }, { ...DRIVE_LEG, polyline: 'x'.repeat(20001) },
      { ...DRIVE_LEG, transitLines: 'none' }, { ...DRIVE_LEG, transitLines: Array.from({ length: 6 }, () => EXPO_LINE) },
    ];
    for (const leg of badLegs) {
      await expectRejected(token, withDriveLeg(leg));
    }
  });

  // Input: a valid session, and a transit line that isn't an object, has an empty name or vehicle, or a
  //        colour, headsign, departure stop or arrival stop that is too long, or a stop count of -1
  // Expected status code: 400
  // Expected behavior: optional transit details may be null, but not invalid, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Invalid transit lines are rejected', async () => {
    const { token } = await createSignedInUser();
    await expectRejected(token, withTransitLines(['Expo Line']));
    const badFields = [
      { name: '' }, { vehicle: '' }, { colour: TOO_LONG_TEXT }, { headsign: 7 },
      { departureStop: TOO_LONG_TEXT }, { arrivalStop: TOO_LONG_TEXT }, { stopCount: -1 },
    ];
    for (const fields of badFields) {
      await expectRejected(token, withLine(fields));
    }
  });

  // Input: a valid session, and a route with a bad total duration, distance or cost, a costEstimated that
  //        isn't a boolean, a baseline cost of -1, or a cost breakdown that isn't an object or has a bad part
  // Expected status code: 400
  // Expected behavior: every total is a whole, non-negative number, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Invalid totals and cost breakdown are rejected', async () => {
    const { token } = await createSignedInUser();
    const { costBreakdown } = ROUTE_OPTION;
    const badFields = [
      { totalDurationSeconds: -1 }, { totalDistanceMeters: '23650' }, { totalCostCents: 755.5 },
      { costEstimated: 'no' }, { baselineDriveCostCents: -1 },
      { costBreakdown: 755 }, { costBreakdown: { ...costBreakdown, fuelCents: -1 } },
      { costBreakdown: { ...costBreakdown, parkingCents: null } }, { costBreakdown: { ...costBreakdown, fareCents: '335' } },
    ];
    for (const fields of badFields) {
      await expectRejected(token, withOption(fields));
    }
  });

  // Input: a valid session, and a leave time that is a number, over 40 characters, missing its date,
  //        or on month 13, and an arriveBy that isn't a date
  // Expected status code: 400
  // Expected behavior: times must be real ISO 8601 times with a timezone, and nothing is saved
  // Expected output: { error: "Invalid trip" }
  test('Invalid time formats are rejected', async () => {
    const { token } = await createSignedInUser();
    const badTimes = [1762183800000, `2026-11-03T15:30:00.${'0'.repeat(30)}Z`, '15:30:00Z', '2026-13-03T15:30:00.000Z'];
    for (const leaveAt of badTimes) {
      await expectRejected(token, withOption({ leaveAt }));
    }
    await expectRejected(token, tripBody({ arriveBy: 'tomorrow at 9' }));
  });

  // Input: no Authorization header, and a valid body
  // Expected status code: 401
  // Expected behavior: request is rejected, and nothing is saved
  // Expected output: { error: "Unauthorized" }
  test('No session', async () => {
    const response = await request(createApp()).post(PATH).send(tripBody());

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
    expect(await TripModel.countDocuments()).toBe(0);
  });
});
