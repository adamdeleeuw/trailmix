import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { TransitLine } from '../../src/models/trip.model';
import { decodeFeed } from '../../src/services/gtfs-rt-decoder';
import { alertsForLines, matchLine, predictLine, type LineMatch } from '../../src/services/live-match';
import { routeIdForTrip, translinkStatic } from '../../src/services/translink-static';
import { alertEntity, feedBytes, tripUpdateEntity, type StopSpec } from '../helpers/gtfs-rt';

// these use TransLink's real network from src/data/, so they also check the committed GTFS files fit the matcher
const network = translinkStatic();

const NOW = 1_794_900_000; // 2026-11-17, seconds since the epoch
const PLANNED = new Date(NOW * 1000 + 10 * 60 * 1000); // the trip boards 10 minutes from now
const PLANNED_SECONDS = NOW + 600;

// Google's 99 from UBC to Commercial-Broadway, with Google's names and stops a few metres off TransLink's
const BUS_99: TransitLine = {
  name: 'UBC/Commercial-Broadway',
  shortName: '99',
  vehicle: 'Bus',
  colour: '#00843D',
  headsign: 'Commercial-Broadway Station',
  departureStop: 'UBC Exchange Bay 7',
  arrivalStop: 'Commercial-Broadway Station Bay 1',
  stopCount: 15,
  departureStopLocation: { lat: 49.26745, lng: -123.24690 },
  arrivalStopLocation: { lat: 49.26225, lng: -123.06900 },
  departAt: PLANNED,
  arriveAt: new Date(PLANNED.getTime() + 35 * 60 * 1000),
};
// TransLink's IDs for it: route 099, eastbound, UBC Exchange @ Bay 7 to Commercial-Broadway Station @ Bay 1
const BUS_99_MATCH: LineMatch = { routeId: '6641', directionId: 0, boardingStopId: '12057', alightingStopId: '11588' };

// Google's Expo Line from Production Way to Waterfront, at the stations' locations rather than a platform's
const EXPO_LINE: TransitLine = {
  name: 'Expo Line',
  shortName: '',
  vehicle: 'SkyTrain',
  colour: '#0060A9',
  headsign: 'Waterfront',
  departureStop: 'Production Way-University',
  arrivalStop: 'Waterfront',
  stopCount: 19,
  departureStopLocation: { lat: 49.2535, lng: -122.9181 },
  arrivalStopLocation: { lat: 49.2859, lng: -123.1117 },
  departAt: PLANNED,
  arriveAt: null,
};
// westbound (direction 1) from Production Way-University @ Platform 2 to Waterfront @ Platform 1
const EXPO_MATCH: LineMatch = { routeId: '30053', directionId: 1, boardingStopId: '8756', alightingStopId: '8078' };

describe('matchLine', () => {
  // Input: Google's 99, whose short name TransLink writes "099" and whose stop names differ from TransLink's
  // Expected: route 099 eastbound, boarding at UBC Exchange @ Bay 7 and getting off at Commercial-Broadway @ Bay 1
  test('matches a bus by its short name and nearest stops', () => {
    expect(matchLine(BUS_99, network)).toStrictEqual(BUS_99_MATCH);
  });

  // Input: the same 99 going the other way, from Commercial-Broadway back to UBC
  // Expected: the westbound direction and its own stops, not the eastbound ones a few metres away
  test('tells the two directions of a bus apart', () => {
    const westbound = {
      ...BUS_99,
      departureStopLocation: { lat: 49.26242, lng: -123.06875 }, // Commercial-Broadway Station @ Bay 5
      arrivalStopLocation: { lat: 49.26767, lng: -123.24762 }, // UBC Exchange @ Unloading Only
    };

    expect(matchLine(westbound, network)).toStrictEqual({
      routeId: '6641', directionId: 1, boardingStopId: '11606', alightingStopId: '12600',
    });
  });

  // Input: Google's Expo Line, which has no short name, with the stations' locations; each station's two platforms
  //        are about 10 m apart and both directions serve both stations
  // Expected: the Expo Line by name, westbound, because only that direction reaches Waterfront after Production Way
  test('matches a SkyTrain line by name and its direction by stop order', () => {
    expect(matchLine(EXPO_LINE, network)).toStrictEqual(EXPO_MATCH);
    expect(matchLine({ ...EXPO_LINE, name: 'EXPO LINE ' }, network)?.routeId).toBe('30053');
  });

  // Input: a 99 saved before #87, with no stop locations, and stop names as TransLink or Google write them
  // Expected: the stops are matched by name, ignoring "@" and capitals
  test('matches stops by name when the trip has no locations', () => {
    const noLocations = { ...BUS_99, departureStopLocation: null, arrivalStopLocation: null };

    expect(matchLine({ ...noLocations, departureStop: 'UBC Exchange @ Bay 7' }, network)).toStrictEqual(BUS_99_MATCH);
    expect(matchLine(noLocations, network)).toStrictEqual(BUS_99_MATCH);
  });

  // Input: a 99 whose alighting stop is nowhere near the route
  // Expected: the line still matches at its boarding stop, so its alerts and departure can still be found
  test('keeps a match without an alighting stop', () => {
    const farOff = { ...BUS_99, arrivalStopLocation: { lat: 49.0, lng: -122.0 }, arrivalStop: 'Nowhere' };

    expect(matchLine(farOff, network)).toStrictEqual({ ...BUS_99_MATCH, alightingStopId: null });
  });

  // Input: a line TransLink doesn't run, a 99 boarding 1 km from any of its stops, a name-only stop that isn't on
  //        the route, and a line with neither a short name nor a known name
  // Expected: no match, so the leg keeps its scheduled times
  test('returns null when the line or its boarding stop is not found', () => {
    expect(matchLine({ ...BUS_99, shortName: '999' }, network)).toBeNull();
    expect(matchLine({ ...BUS_99, departureStopLocation: { lat: 49.2760, lng: -123.2460 } }, network)).toBeNull();
    expect(matchLine({ ...BUS_99, departureStopLocation: null, departureStop: 'Waterfront Station' }, network)).toBeNull();
    expect(matchLine({ ...BUS_99, shortName: null, name: 'Gondola' }, network)).toBeNull();
  });
});

describe('alertsForLines', () => {
  const alerts = (entities: number[][]) => decodeFeed(feedBytes(NOW, entities));
  const ids = (found: ReturnType<typeof alertsForLines>) => found.map((alert) => [alert.id, alert.lineIndexes]);

  // Input: alerts on the 99's route, on the Expo Line westbound, at Waterfront station (the parent of the trip's
  //        platform), and at the 99's boarding stop for buses
  // Expected: each alert, with the trip lines it applies to
  test('finds alerts on a line, its direction, its stops and their stations', () => {
    const found = alertsForLines(alerts([
      alertEntity({ id: 'route', selectors: [{ routeId: '6641' }] }),
      alertEntity({ id: 'direction', selectors: [{ routeId: '30053', directionId: 1 }] }),
      alertEntity({ id: 'station', selectors: [{ stopId: '12034' }] }),
      alertEntity({ id: 'stop', selectors: [{ stopId: '12057', routeType: 3 }] }),
    ]), [BUS_99_MATCH, EXPO_MATCH], network, NOW);

    expect(ids(found)).toStrictEqual([['route', [0]], ['direction', [1]], ['station', [1]], ['stop', [0]]]);
    expect(found[0]?.alert.informedEntities).toHaveLength(1);
  });

  // Input: alerts on another route, the Expo Line eastbound, the 99 at a SkyTrain route type, a stop the trip only
  //        passes through, and one that names the 99 but is deleted
  // Expected: none of them, since each selector's fields must all match
  test('skips alerts for other routes, directions and stops', () => {
    const found = alertsForLines(alerts([
      alertEntity({ id: 'other route', selectors: [{ routeId: '37810' }] }),
      alertEntity({ id: 'eastbound', selectors: [{ routeId: '30053', directionId: 0 }] }),
      alertEntity({ id: 'wrong type', selectors: [{ routeId: '6641', routeType: 1 }] }),
      alertEntity({ id: 'passed stop', selectors: [{ stopId: '8044' }] }),
      alertEntity({ id: 'deleted', selectors: [{ routeId: '6641' }], deleted: true }),
    ]), [BUS_99_MATCH, EXPO_MATCH], network, NOW);

    expect(found).toStrictEqual([]);
  });

  // Input: network-wide alerts, as TransLink sends them: one naming only the agency, one for all buses (route type 3,
  //        like the saved feed's Compass Card notice), one for all buses in direction 0, and one for all SkyTrain
  // Expected: none of them, since none names one of the trip's routes or stops
  test('skips network-wide alerts', () => {
    const found = alertsForLines(alerts([
      alertEntity({ id: 'agency', selectors: [{}] }),
      alertEntity({ id: 'all buses', selectors: [{ routeType: 3 }] }),
      alertEntity({ id: 'all buses one way', selectors: [{ routeType: 3, directionId: 0 }] }),
      alertEntity({ id: 'all SkyTrain', selectors: [{ routeType: 1 }, { directionId: 1 }] }),
    ]), [BUS_99_MATCH, EXPO_MATCH], network, NOW);

    expect(found).toStrictEqual([]);
  });

  // Input: one alert with a network-wide selector and a selector naming the 99's route
  // Expected: the alert, for the 99 only, since one selector naming the line is enough
  test('keeps an alert that also names one of the lines', () => {
    const found = alertsForLines(alerts([
      alertEntity({ id: 'mixed', selectors: [{ routeType: 3 }, { routeId: '6641' }] }),
    ]), [BUS_99_MATCH, EXPO_MATCH], network, NOW);

    expect(ids(found)).toStrictEqual([['mixed', [0]]]);
  });

  // Input: 99 alerts that ended, haven't started, are open-ended, or have one current period among others
  // Expected: only the ones in effect now
  test('keeps only alerts in effect now', () => {
    const found = alertsForLines(alerts([
      alertEntity({ id: 'ended', periods: [{ start: NOW - 7200, end: NOW - 1 }], selectors: [{ routeId: '6641' }] }),
      alertEntity({ id: 'later', periods: [{ start: NOW + 60 }], selectors: [{ routeId: '6641' }] }),
      alertEntity({ id: 'open', periods: [{ start: NOW - 60 }], selectors: [{ routeId: '6641' }] }),
      alertEntity({
        id: 'second period', periods: [{ end: NOW - 3600 }, { start: NOW, end: NOW + 60 }], selectors: [{ routeId: '6641' }],
      }),
    ]), [BUS_99_MATCH], network, NOW);

    expect(ids(found)).toStrictEqual([['open', [0]], ['second period', [0]]]);
  });

  // Input: an alert on the 99 for a trip whose first line didn't match and whose second is the 99
  // Expected: the alert, on line 1
  test('skips lines that did not match', () => {
    const found = alertsForLines(alerts([alertEntity({ id: 'route', selectors: [{ routeId: '6641' }] })]), [null, BUS_99_MATCH], network, NOW);

    expect(ids(found)).toStrictEqual([['route', [1]]]);
  });
});

describe('predictLine', () => {
  interface RunExtra { directionId?: number; cancelled?: boolean; delay?: number; routeId?: string; tripId?: string }
  const run = (id: string, stops: StopSpec[], extra: RunExtra = {}) =>
    tripUpdateEntity(extra.tripId === undefined ? { id, routeId: '6641', ...extra, stops } : { id, ...extra, stops });
  const trips = (entities: number[][]) => decodeFeed(feedBytes(NOW, entities));

  // Input: three eastbound 99 runs at the boarding stop, scheduled 8 minutes before, 1 minute after and 9 minutes
  //        after the planned departure, the planned one 3 minutes late
  // Expected: the run scheduled closest to the plan, leaving 3 minutes late, with its arrival at the alighting stop
  test('picks the run the trip planned to take', () => {
    const prediction = predictLine(trips([
      run('earlier', [{ stopId: '12057', departure: { time: PLANNED_SECONDS - 480, delay: 0 } }]),
      run('planned', [
        { stopId: '12057', departure: { time: PLANNED_SECONDS + 60 + 180, delay: 180 } },
        { stopId: '11588', arrival: { time: PLANNED_SECONDS + 2400, delay: 240 } },
      ], { directionId: 0 }),
      run('later', [{ stopId: '12057', departure: { time: PLANNED_SECONDS + 540, delay: 0 } }]),
    ]), BUS_99_MATCH, PLANNED, network);

    expect(prediction).toStrictEqual({
      departAt: new Date((PLANNED_SECONDS + 240) * 1000),
      arriveAt: new Date((PLANNED_SECONDS + 2400) * 1000),
      delaySeconds: 240,
      cancelled: false,
    });
  });

  // Input: runs with only a trip_id, as most of TransLink's are: one of the 99's, one of the Expo Line's, and one the
  //        schedule doesn't have
  // Expected: the 99's run, its route found from the schedule's trip_id ranges
  test('finds a run\'s route from its trip_id', () => {
    const atBoarding = (offset: number) => [{ stopId: '12057', departure: { time: PLANNED_SECONDS + offset, delay: offset } }];
    const prediction = predictLine(trips([
      run('expo', atBoarding(0), { tripId: '15521851' }),
      run('unknown', atBoarding(0), { tripId: '99999999' }),
      run('99', atBoarding(120), { tripId: '15460920' }),
    ]), BUS_99_MATCH, PLANNED, network);

    expect(prediction).toMatchObject({ delaySeconds: 120 });
  });

  // Input: a run with only an arrival time at the boarding stop and the run's delay instead of the stop's, and no
  //        prediction at the alighting stop
  // Expected: the arrival is used as the departure, the run's delay picks it, and the arrival is unknown
  test('falls back to the arrival time and the run delay', () => {
    const prediction = predictLine(trips([
      run('only arrival', [{ stopId: '12057', arrival: { time: PLANNED_SECONDS + 300 } }], { delay: 300 }),
    ]), BUS_99_MATCH, PLANNED, network);

    expect(prediction).toStrictEqual({
      departAt: new Date((PLANNED_SECONDS + 300) * 1000), arriveAt: null, delaySeconds: 300, cancelled: false,
    });
  });

  // Input: the planned run cancelled, and the planned run skipping the boarding stop
  // Expected: cancelled, so the app can say the bus isn't coming
  test('reports cancelled runs and skipped stops', () => {
    const departure = { time: PLANNED_SECONDS, delay: 0 };

    expect(predictLine(trips([run('x', [{ stopId: '12057', departure }], { cancelled: true })]), BUS_99_MATCH, PLANNED, network))
      .toMatchObject({ cancelled: true });
    expect(predictLine(trips([run('x', [{ stopId: '12057', departure, skipped: true }])]), BUS_99_MATCH, PLANNED, network))
      .toMatchObject({ cancelled: true });
  });

  // Input: runs of another route, the other direction, without the boarding stop, without times, scheduled 11 minutes
  //        off, and a deleted one
  // Expected: no prediction, so the leg keeps its scheduled time
  test('returns null when no run is the planned one', () => {
    const atBoarding = [{ stopId: '12057', departure: { time: PLANNED_SECONDS, delay: 0 } }];
    const feed = decodeFeed(feedBytes(NOW, [
      run('other route', atBoarding, { routeId: '37810' }),
      run('westbound', atBoarding, { directionId: 1 }),
      run('elsewhere', [{ stopId: '11588', departure: { time: PLANNED_SECONDS } }]),
      run('no time', [{ stopId: '12057', departure: { delay: 60 } }]),
      run('too far off', [{ stopId: '12057', departure: { time: PLANNED_SECONDS + 660, delay: 0 } }]),
    ]));
    feed.entities.push({ id: 'deleted', deleted: true, alert: null, tripUpdate: decodeFeed(feedBytes(NOW, [run('d', atBoarding)])).entities[0]?.tripUpdate ?? null });

    expect(predictLine(feed, BUS_99_MATCH, PLANNED, network)).toBeNull();
  });
});

describe('routeIdForTrip', () => {
  // Input: trip_ids at the ends and inside of the 99's and Expo Line's ranges, one between ranges, one past every
  //        range, a non-numeric one and null
  // Expected: the 99's and Expo Line's route IDs, then null for the rest
  test('finds the route of a trip_id', () => {
    expect(routeIdForTrip(network, '15460920')).toBe('6641');
    expect(routeIdForTrip(network, '15461751')).toBe('6641');
    expect(routeIdForTrip(network, '15522000')).toBe('30053');
    expect(routeIdForTrip(network, '15461752')).not.toBe('6641');
    expect(routeIdForTrip(network, '99999999')).toBeNull();
    expect(routeIdForTrip(network, '1')).toBeNull();
    expect(routeIdForTrip(network, 'ABC-123')).toBeNull();
    expect(routeIdForTrip(network, null)).toBeNull();
  });

  // Input: every run in TransLink's saved trip updates feed
  // Expected: the schedule knows each run's trip_id, and agrees with the route_id of every run that gives one
  test('knows every run in the saved feed', () => {
    const feed = decodeFeed(readFileSync(path.join(__dirname, '..', 'fixtures', 'translink', 'gtfsrealtime.pb')));
    const runs = feed.entities.flatMap((entity) => entity.tripUpdate ?? []);

    expect(runs.every((tripRun) => routeIdForTrip(network, tripRun.tripId) !== null)).toBe(true);
    for (const tripRun of runs.filter((r) => r.routeId !== null)) {
      expect(routeIdForTrip(network, tripRun.tripId)).toBe(tripRun.routeId);
    }
  });
});
