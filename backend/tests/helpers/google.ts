const ROUTE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

/** A transit-only plan request between two fixed places, the cheapest plan the Planner can make. */
export const TRANSIT_PLAN = {
  origin: { label: 'UBC', lat: 49.2606, lng: -123.246, placeId: 'ubc' },
  destination: { label: 'Downtown Vancouver', lat: 49.2827, lng: -123.1207, placeId: 'downtown' },
  arriveBy: null,
  modes: ['TRANSIT'],
};

const MATRIX = [{ originIndex: 0, destinationIndex: 0, duration: '1200s', distanceMeters: 5000, condition: 'ROUTE_EXISTS' }];
const DETAILS = {
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

/** Waits [milliseconds] of real time. */
export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** What Google's Routes API answers for {@link TRANSIT_PLAN} at [url]: one matrix element, or one route's details. */
export function googleAnswer(url: unknown): object {
  return String(url).includes('computeRouteMatrix') ? MATRIX : DETAILS;
}

/**
 * Fakes Google's Routes API for {@link TRANSIT_PLAN}, so every plan succeeds without the network.
 *
 * @param delayMs - How long each Google call takes before it answers.
 * @returns The spied `fetch`, whose calls are the Google calls made.
 */
export function fakeGoogleRoutes(delayMs = 0): jest.SpiedFunction<typeof fetch> {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (delayMs > 0) await wait(delayMs);
    return new Response(JSON.stringify(googleAnswer(input)), { status: 200 });
  });
}
