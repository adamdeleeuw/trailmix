import {
  findBikeStationCandidates,
  rankBikeStationCandidates,
  SEEDED_BIKE_STATIONS,
  type BikeStation,
  type BikeStationSearch,
} from '../../src/services/bike-station.service';

const origin = { label: 'Origin', lat: 0, lng: 0, placeId: null };
const destination = { label: 'Destination', lat: 0, lng: 0.1, placeId: null };

function station(id: string, lat: number, lng: number, name = id, source: BikeStation['source'] = 'GTFS'): BikeStation {
  return { id, name, lat, lng, source };
}

function placesResponse(places: unknown[]): Response {
  return new Response(JSON.stringify({ places }), { status: 200 });
}

function googlePlace(
  id: string,
  latitude: number,
  longitude: number,
  types: string[] = ['transit_station'],
  name = id,
): object {
  return {
    id,
    displayName: { text: name },
    location: { latitude, longitude },
    types,
  };
}

const nearZeroJourney: BikeStationSearch = {
  origin,
  destination,
  bikeLegEndpoint: 'ORIGIN',
  maxCyclingDistanceMeters: 1000,
  candidateCount: 3,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('rankBikeStationCandidates', () => {
  test('keeps stations within the cycling distance and excludes those outside it', () => {
    const ranked = rankBikeStationCandidates(
      { origin, destination, bikeLegEndpoint: 'ORIGIN' },
      [
        station('inside', 0, 0.005),
        station('outside', 0, 0.02),
      ],
      1000,
      5,
    );

    expect(ranked.map(({ id }) => id)).toEqual(['inside']);
    expect(ranked[0]?.cyclingDistanceMeters).toBeLessThanOrEqual(1000);
  });

  test('prefers stations along the journey over stations offset from it', () => {
    const ranked = rankBikeStationCandidates(
      { origin, destination, bikeLegEndpoint: 'ORIGIN' },
      [
        station('offset', 0.01, 0.01),
        station('aligned', 0, 0.01),
      ],
      2000,
      5,
    );

    expect(ranked.map(({ id }) => id)).toEqual(['aligned', 'offset']);
    expect(ranked[0]?.routeDeviationMeters).toBeLessThan(ranked[1]?.routeDeviationMeters ?? 0);
  });

  test('rejects stations outside the journey corridor that add excessive detour', () => {
    const shortDestination = { ...destination, lng: 0.02 };
    const ranked = rankBikeStationCandidates(
      { origin, destination: shortDestination, bikeLegEndpoint: 'ORIGIN' },
      [station('detour', 0.025, 0.01)],
      3000,
      5,
    );

    expect(ranked).toEqual([]);
  });

  test('uses the destination as the cycling endpoint for transit-to-bike journeys', () => {
    const ranked = rankBikeStationCandidates(
      { origin, destination, bikeLegEndpoint: 'DESTINATION' },
      [
        station('near-destination', 0, 0.095),
        station('near-origin', 0, 0.005),
      ],
      1000,
      5,
    );

    expect(ranked.map(({ id }) => id)).toEqual(['near-destination']);
  });

  test('removes duplicate station locations and returns only the best few', () => {
    const ranked = rankBikeStationCandidates(
      { origin, destination, bikeLegEndpoint: 'ORIGIN' },
      [
        station('first', 0, 0.001, 'Station A'),
        station('duplicate', 0, 0.0011, 'Station A'),
        station('second', 0, 0.002, 'Station B'),
        station('third', 0, 0.003, 'Station C'),
      ],
      1000,
      2,
    );

    expect(ranked.map(({ id }) => id)).toEqual(['first', 'second']);
  });
});

describe('findBikeStationCandidates', () => {
  test('uses the seeded TransLink stations', async () => {
    expect(SEEDED_BIKE_STATIONS.length).toBeGreaterThan(0);
    const waterfront = SEEDED_BIKE_STATIONS.find((value) => value.name === 'Waterfront Station');
    expect(waterfront).toBeDefined();
    const fetch = jest.spyOn(globalThis, 'fetch');

    const ranked = await findBikeStationCandidates({
      origin: { label: 'Waterfront', lat: waterfront?.lat ?? 0, lng: waterfront?.lng ?? 0, placeId: null },
      destination: { label: 'North', lat: (waterfront?.lat ?? 0) + 0.01, lng: waterfront?.lng ?? 0, placeId: null },
      bikeLegEndpoint: 'ORIGIN',
      maxCyclingDistanceMeters: 500,
      candidateCount: 1,
    });

    expect(ranked[0]).toMatchObject({ name: 'Waterfront Station', source: 'GTFS' });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('uses Google Places only when seeded stations cannot fill the requested count', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      placesResponse([
        googlePlace('rail', 0, 0.001, ['train_station']),
        googlePlace('bus-only', 0, 0.002, ['bus_station']),
        googlePlace('invalid-location', 100, 0, ['transit_station']),
      ]),
    );
    const oldKey = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = 'test-places-api-key';

    try {
      const ranked = await findBikeStationCandidates(nearZeroJourney);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        'https://places.googleapis.com/v1/places:searchNearby',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Goog-Api-Key': 'test-places-api-key' }),
        }),
      );
      expect(ranked.map(({ id, source }) => ({ id, source }))).toEqual([{ id: 'rail', source: 'GOOGLE_PLACES' }]);
    } finally {
      if (oldKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = oldKey;
    }
  });

  test('reuses cached Places results for the same nearby station query', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      placesResponse([googlePlace('cached-rail', 0, 0.001)]),
    );
    const oldKey = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = 'test-places-api-key';

    try {
      const search = { ...nearZeroJourney, origin: { ...origin, lng: 0.0003 } };
      await findBikeStationCandidates(search);
      await findBikeStationCandidates(search);

      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      if (oldKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = oldKey;
    }
  });

  test('returns an empty list when Places succeeds without results', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(placesResponse([]));
    const oldKey = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = 'test-places-api-key';

    try {
      await expect(findBikeStationCandidates({
        ...nearZeroJourney,
        origin: { ...origin, lat: 0.0007 },
      })).resolves.toEqual([]);
    } finally {
      if (oldKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = oldKey;
    }
  });

  test('keeps seeded candidates when Places responds with an HTTP error', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const oldKey = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = 'test-places-api-key';

    try {
      const ranked = await findBikeStationCandidates({
        origin: { label: 'Waterfront', lat: 49.285687, lng: -123.111773, placeId: null },
        destination: { label: 'North', lat: 49.295687, lng: -123.111773, placeId: null },
        bikeLegEndpoint: 'ORIGIN',
        maxCyclingDistanceMeters: 500,
        candidateCount: 2,
      });

      expect(ranked.map(({ name, source }) => ({ name, source }))).toEqual([
        { name: 'Waterfront Station', source: 'GTFS' },
      ]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Places fallback failed'), expect.any(Error));
    } finally {
      if (oldKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = oldKey;
    }
  });

  test('keeps seeded candidates when the Places fallback fails', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network unavailable'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const oldKey = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = 'test-places-api-key';

    try {
      const ranked = await findBikeStationCandidates({
        origin: { label: 'Waterfront', lat: 49.285687, lng: -123.111773, placeId: null },
        destination: { label: 'North', lat: 49.295687, lng: -123.111773, placeId: null },
        bikeLegEndpoint: 'ORIGIN',
        maxCyclingDistanceMeters: 500,
        candidateCount: 2,
      });

      expect(ranked.map(({ name }) => name)).toEqual(['Waterfront Station']);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Places fallback failed'), expect.any(Error));
    } finally {
      if (oldKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = oldKey;
    }
  });
});
