import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Leg, TransitLine } from '../../src/models/trip.model';
import { decodeFeed, type Feed } from '../../src/services/gtfs-rt-decoder';
import type { FeedState } from '../../src/services/live-feeds';
import { buildLiveUpdate, hasTransitAhead, STALE_AFTER_MS } from '../../src/services/live-updates.service';
import { translinkStatic } from '../../src/services/translink-static';
import { alertEntity, feedBytes } from '../helpers/gtfs-rt';
import { bus99Feed, bus99Line, busThenWalkLegs, detourFeed } from '../helpers/live';

const network = translinkStatic();
const fixture = (name: string) => decodeFeed(readFileSync(path.join(__dirname, '..', 'fixtures', 'translink', name)));

const ok = (feed: Feed, fetchedAt: number): FeedState => ({ status: 'ok', feed, fetchedAt });
const failed = (status: FeedState['status'], fetchedAt: number): FeedState => ({ status, feed: null, fetchedAt });

const WALK: Leg = {
  mode: 'WALK', from: { label: 'Home', lat: 49.25, lng: -123.0, placeId: null }, to: { label: 'Stop', lat: 49.2515, lng: -123.0041, placeId: null },
  departAt: null, arriveAt: null, durationSeconds: 120, distanceMeters: 150, costCents: 0, polyline: 'walk', transitLines: [], steps: [],
};

describe('buildLiveUpdate with TransLink\'s saved feeds', () => {
  // the saved feeds' run 15456173 of the 025, which left Willingdon Ave @ Goard Way 51 s early
  const tripUpdates = fixture('gtfsrealtime.pb');
  const alerts = fixture('gtfsalerts.pb');
  const now = (tripUpdates.timestamp ?? 0) * 1000;
  const plannedDepart = new Date((1_794_986_756 + 51) * 1000);
  const bus25: TransitLine = {
    ...bus99Line(plannedDepart),
    name: 'King Edward', shortName: '25', headsign: 'Brentwood Station',
    departureStop: 'Willingdon Ave @ Goard Way', arrivalStop: 'Willingdon Ave @ Still Creek Dr',
    departureStopLocation: { lat: 49.25155, lng: -123.00410 }, arrivalStopLocation: { lat: 49.26160, lng: -123.00310 },
  };
  const legs: Leg[] = [WALK, {
    ...WALK, mode: 'TRANSIT', departAt: plannedDepart, arriveAt: new Date(plannedDepart.getTime() + 180_000), transitLines: [bus25],
  }];

  // Input: a walk, then the 025 planned to leave when run 15456173 was scheduled to, against TransLink's real feeds
  // Expected output: live; the bus leg matched to that run, 51 s early, with its predicted arrival at Still Creek;
  //                  and the real alert on the 025's alighting stop, on leg 1, but not the network-wide Compass
  //                  Card notice
  test('matches a real run and its alerts', () => {
    const update = buildLiveUpdate(legs, 0, { tripUpdates: ok(tripUpdates, now), alerts: ok(alerts, now) }, network, now);

    expect(update.live).toBe(true);
    expect(update.updatedAt).toStrictEqual(new Date((alerts.timestamp ?? 0) * 1000));
    expect(update.legs).toStrictEqual([{
      legIndex: 1,
      matched: true,
      departAt: new Date(1_794_986_756 * 1000),
      arriveAt: new Date(1_794_986_906 * 1000),
      delaySeconds: -51,
      cancelled: false,
    }]);
    // 769018, a Compass Card notice for every route type, is network-wide, so it isn't shown
    expect(update.alerts.map((alert) => [alert.id, alert.effect, alert.legIndexes])).toStrictEqual([
      ['769063', 'STOP_MOVED', [1]],
    ]);
    for (const alert of update.alerts) {
      expect(alert.header).not.toBe('');
      expect(alert.description ?? '').not.toContain('\r');
    }
  });

  // Input: the same, ten minutes after the feeds were made
  // Expected output: not live, the leg at its scheduled times, no alerts
  test('says not live once the feeds are stale', () => {
    const later = now + STALE_AFTER_MS + 1000;
    const update = buildLiveUpdate(legs, 0, { tripUpdates: ok(tripUpdates, now), alerts: ok(alerts, now) }, network, later);

    expect(update).toStrictEqual({
      live: false,
      updatedAt: null,
      legs: [{ legIndex: 1, matched: false, departAt: plannedDepart, arriveAt: legs[1]?.arriveAt, delaySeconds: null, cancelled: false }],
      alerts: [],
    });
  });
});

describe('buildLiveUpdate', () => {
  const NOW = 1_794_900_000_000;
  const nowSeconds = NOW / 1000;
  const departAt = new Date(NOW + 10 * 60_000);
  const legs = busThenWalkLegs(departAt);
  const runs = decodeFeed(bus99Feed(nowSeconds, departAt, 240));
  const detour = decodeFeed(detourFeed(nowSeconds, nowSeconds + 3600));

  // Input: each way the trip updates feed can be unusable, with the alerts feed fine
  // Expected output: not live, the leg at scheduled times, and the 99's detour still shown
  test.each([
    ['missing', null],
    ['capped', failed('capped', NOW)],
    ['rate-limited', failed('rate-limited', NOW)],
    ['failed', failed('failed', NOW)],
    ['undecodable', failed('undecodable', NOW)],
    ['unconfigured', failed('unconfigured', NOW)],
  ] as [string, FeedState | null][])('falls back when trip updates are %s', (_name, state) => {
    const update = buildLiveUpdate(legs, 0, { tripUpdates: state, alerts: ok(detour, NOW) }, network, NOW);

    expect(update.live).toBe(false);
    expect(update.updatedAt).toBeNull();
    expect(update.legs).toStrictEqual([{ legIndex: 0, matched: false, departAt, arriveAt: legs[0]?.arriveAt, delaySeconds: null, cancelled: false }]);
    expect(update.alerts.map((alert) => alert.id)).toStrictEqual(['detour-99']);
  });

  // Input: trip updates fine, the alerts feed failed
  // Expected output: not live, scheduled times, no alerts
  test('falls back when alerts are unusable', () => {
    const update = buildLiveUpdate(legs, 0, { tripUpdates: ok(runs, NOW), alerts: failed('failed', NOW) }, network, NOW);

    expect(update).toMatchObject({ live: false, legs: [{ matched: false }], alerts: [] });
  });

  // Input: the rider on the walk after the bus, with only the alerts feed polled
  // Expected output: live on alerts alone, with no legs, and the 99's detour no longer shown
  test('needs only alerts once the transit is done', () => {
    const update = buildLiveUpdate(legs, 1, { tripUpdates: null, alerts: ok(detour, NOW) }, network, NOW);

    expect(update).toStrictEqual({ live: true, updatedAt: new Date(NOW), legs: [], alerts: [] });
    expect(hasTransitAhead(legs, 0)).toBe(true);
    expect(hasTransitAhead(legs, 1)).toBe(false);
  });

  // Input: the planned run cancelled, and (in a second feed) the planned run skipping the boarding stop
  // Expected output: live, with the leg matched and cancelled, at its scheduled times and no delay
  test('marks a leg whose run is cancelled', () => {
    for (const how of ['cancelled', 'skipped'] as const) {
      const feed = decodeFeed(bus99Feed(nowSeconds, departAt, 120));
      const run = feed.entities[0]?.tripUpdate;
      if (run && how === 'cancelled') run.cancelled = true;
      const boarding = run?.stopTimeUpdates[0];
      if (boarding && how === 'skipped') boarding.skipped = true;

      const update = buildLiveUpdate(legs, 0, { tripUpdates: ok(feed, NOW), alerts: ok(detour, NOW) }, network, NOW);

      expect(update.live).toBe(true);
      expect(update.legs).toStrictEqual([
        { legIndex: 0, matched: true, departAt, arriveAt: legs[0]?.arriveAt, delaySeconds: null, cancelled: true },
      ]);
    }
  });

  // Input: a leg that boards the 99, then transfers to a second 99 run that's cancelled
  // Expected output: the leg is cancelled, since the transfer isn't coming
  test('marks a leg whose transfer run is cancelled', () => {
    const transferAt = new Date(departAt.getTime() + 20 * 60_000);
    const firstLeg = legs[0];
    if (firstLeg === undefined) throw new Error('Expected a first leg in the test fixture');
    const withTransfer: Leg = { ...firstLeg, transitLines: [bus99Line(departAt), bus99Line(transferAt)] };
    const feed = decodeFeed(bus99Feed(nowSeconds, departAt, 0));
    const transferRun = decodeFeed(bus99Feed(nowSeconds, transferAt, 0)).entities[0];
    if (transferRun?.tripUpdate) {
      transferRun.id = 'transfer';
      transferRun.tripUpdate.cancelled = true;
      feed.entities.push(transferRun);
    }

    const update = buildLiveUpdate([withTransfer], 0, { tripUpdates: ok(feed, NOW), alerts: ok(detour, NOW) }, network, NOW);

    expect(update.legs[0]).toMatchObject({ matched: true, cancelled: true, delaySeconds: null });
  });

  // Input: a bus leg with a transfer to a second line that no TransLink route has, and a leg whose line has no
  //        planned time
  // Expected output: the first leg departs on the 99's run, and arrives at its schedule moved by the same delay;
  //                  the second leg is unmatched
  test('moves the scheduled arrival when the last line has no prediction', () => {
    const transfer = { ...bus99Line(departAt), shortName: 'X99', name: 'Not a route' };
    const firstLeg = legs[0] as Leg;
    const twoLines: Leg = { ...firstLeg, transitLines: [bus99Line(departAt), transfer] };
    const untimed: Leg = { ...firstLeg, departAt: null, transitLines: [{ ...bus99Line(departAt), departAt: null }] };

    const update = buildLiveUpdate([twoLines, untimed], 0, { tripUpdates: ok(runs, NOW), alerts: ok(detour, NOW) }, network, NOW);

    expect(update.legs).toStrictEqual([
      {
        legIndex: 0,
        matched: true,
        departAt: new Date(departAt.getTime() + 240_000),
        arriveAt: new Date((firstLeg.arriveAt?.getTime() ?? 0) + 240_000),
        delaySeconds: 240,
        cancelled: false,
      },
      { legIndex: 1, matched: false, departAt: null, arriveAt: firstLeg.arriveAt, delaySeconds: null, cancelled: false },
    ]);
    expect(update.alerts[0]?.legIndexes).toStrictEqual([0, 1]);
  });

  // Input: alerts with no header, no description and no end, and a feed with no header timestamp
  // Expected output: a generic header, a null description and activeUntil, and the fetch time as updatedAt
  test('fills in what an alert leaves out', () => {
    const bare = decodeFeed(feedBytes(nowSeconds, [alertEntity({ id: 'bare', selectors: [{ routeId: '6641' }] })]));
    bare.timestamp = null;

    const update = buildLiveUpdate(legs, 0, { tripUpdates: ok(runs, NOW), alerts: ok(bare, NOW - 5000) }, network, NOW);

    expect(update.updatedAt).toStrictEqual(new Date(NOW - 5000));
    expect(update.alerts).toStrictEqual([{
      id: 'bare', header: 'Service alert', description: null, effect: 'UNKNOWN_EFFECT', legIndexes: [0], activeUntil: null,
    }]);
  });
});
