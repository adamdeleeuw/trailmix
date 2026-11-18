/**
 * Trips and fake TransLink feeds for the live update tests (#87).
 */
import type { Types } from 'mongoose';
import type { Leg, TransitLine, TripStatus } from '../../src/models/trip.model';
import { createTrip } from './trips';
import { alertEntity, feedBytes, tripUpdateEntity } from './gtfs-rt';

/** A made-up key the tests set, so they can check it never leaks. Real TransLink never sees it: fetch is mocked. */
export const FAKE_TRANSLINK_KEY = 'fake-translink-key-8f3a';

const UBC = { label: 'UBC Exchange', lat: 49.26745, lng: -123.2469, placeId: null };
const COMMERCIAL = { label: 'Commercial-Broadway', lat: 49.26225, lng: -123.069, placeId: null };
const DOWNTOWN = { label: 'Office', lat: 49.2655, lng: -123.0695, placeId: null };

/** TransLink's IDs for the 99 below: route 099, eastbound, boarding at UBC Exchange @ Bay 7. */
export const BUS_99 = { routeId: '6641', boardingStopId: '12057', alightingStopId: '11588', tripId: '15460920' };

/** Google's 99 from UBC to Commercial-Broadway, leaving at `departAt`. */
export function bus99Line(departAt: Date): TransitLine {
  return {
    name: 'UBC/Commercial-Broadway',
    shortName: '99',
    vehicle: 'Bus',
    colour: '#00843D',
    headsign: 'Commercial-Broadway Station',
    departureStop: 'UBC Exchange Bay 7',
    arrivalStop: 'Commercial-Broadway Station Bay 1',
    stopCount: 15,
    departureStopLocation: { lat: UBC.lat, lng: UBC.lng },
    arrivalStopLocation: { lat: COMMERCIAL.lat, lng: COMMERCIAL.lng },
    departAt,
    arriveAt: new Date(departAt.getTime() + 35 * 60_000),
  };
}

/** A trip's legs: the 99 leaving at `departAt` (leg 0), then a short walk (leg 1). */
export function busThenWalkLegs(departAt: Date): Leg[] {
  const arrive = new Date(departAt.getTime() + 35 * 60_000);
  return [
    {
      mode: 'TRANSIT', from: UBC, to: COMMERCIAL, departAt, arriveAt: arrive,
      durationSeconds: 2100, distanceMeters: 13000, costCents: 335, polyline: 'bus', transitLines: [bus99Line(departAt)], steps: [],
    },
    {
      mode: 'WALK', from: COMMERCIAL, to: DOWNTOWN, departAt: arrive, arriveAt: new Date(arrive.getTime() + 300_000),
      durationSeconds: 300, distanceMeters: 400, costCents: 0, polyline: 'walk', transitLines: [], steps: [],
    },
  ];
}

/** Adds a trip with `legs` to the test database, ACTIVE unless told otherwise. */
export async function createLiveTrip(userId: Types.ObjectId, legs: Leg[], status: TripStatus = 'ACTIVE') {
  return createTrip(userId, {
    status,
    origin: legs[0]?.from ?? UBC,
    destination: legs[legs.length - 1]?.to ?? DOWNTOWN,
    legs,
    totalDurationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
    totalDistanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
    totalCostCents: legs.reduce((sum, leg) => sum + leg.costCents, 0),
    costBreakdown: { fuelCents: 0, parkingCents: 0, fareCents: legs.reduce((sum, leg) => sum + leg.costCents, 0) },
    actualStart: status === 'ACTIVE' ? new Date() : null,
  });
}

/**
 * A trip updates feed with the 99's planned run, `delaySeconds` late, given by trip_id only as TransLink does.
 *
 * @param nowSeconds - The feed's timestamp.
 * @param plannedDepart - When the trip planned to board.
 * @param delaySeconds - How late the run is.
 * @param cancelled - Whether TransLink has cancelled the run.
 */
export function bus99Feed(nowSeconds: number, plannedDepart: Date, delaySeconds: number, cancelled = false): Uint8Array {
  const planned = Math.floor(plannedDepart.getTime() / 1000);
  return feedBytes(nowSeconds, [tripUpdateEntity({
    id: BUS_99.tripId,
    tripId: BUS_99.tripId,
    directionId: 0,
    cancelled,
    stops: [
      { stopId: BUS_99.boardingStopId, departure: { time: planned + delaySeconds, delay: delaySeconds } },
      { stopId: BUS_99.alightingStopId, arrival: { time: planned + 2100 + delaySeconds, delay: delaySeconds } },
    ],
  })]);
}

/** An alerts feed with a detour on the 99 until `endSeconds`, one on another route, and a network-wide one for all buses. */
export function detourFeed(nowSeconds: number, endSeconds: number): Uint8Array {
  return feedBytes(nowSeconds, [
    alertEntity({
      id: 'detour-99',
      periods: [{ start: nowSeconds - 3600, end: endSeconds }],
      selectors: [{ routeId: BUS_99.routeId }],
      effect: 4,
      header: '99 detour at Main St',
      description: 'Regular route, then Main St.\r\n\r\n\r\nNo stops missed. ',
    }),
    alertEntity({ id: 'elsewhere', selectors: [{ routeId: '6612' }], effect: 4, header: '2 detour' }),
    alertEntity({ id: 'all-buses', selectors: [{ routeType: 3 }, {}], effect: 7, header: 'Compass Card notice' }),
  ]);
}

/** What fake TransLink answers each feed with: bytes, an HTTP status, or a thrown error. */
export type FakeAnswer = Uint8Array | number | Error;

/** The URL path of each feed, as `translink-api.ts` asks for it. */
export const FEED_PATHS = { tripUpdates: '/v3/gtfsrealtime', alerts: '/v3/gtfsalerts' } as const;

/**
 * Replaces fetch with a fake TransLink. Every other URL fails the test.
 *
 * @param answer - What to send for each feed; called per request, so tests can change it over time.
 * @returns The spy, whose calls are the URLs asked for.
 */
export function fakeTranslink(answer: (kind: keyof typeof FEED_PATHS) => FakeAnswer): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const kind = url.pathname === FEED_PATHS.tripUpdates ? 'tripUpdates' : url.pathname === FEED_PATHS.alerts ? 'alerts' : null;
    if (url.hostname !== 'gtfsapi.translink.ca' || kind === null) throw new Error(`Unexpected fetch of ${url.pathname}`);
    const result = answer(kind);
    if (result instanceof Error) throw result;
    if (typeof result === 'number') return new Response('<html>error</html>', { status: result });
    return new Response(result, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
  });
}
