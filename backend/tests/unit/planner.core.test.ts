import {
  chainLowerBound,
  chooseRoute,
  filterChains,
  pickThree,
  priceChain,
  pruneSpots,
  transitLowerBoundSeconds,
  scheduleBikeTransit,
  scheduleChain,
  scheduleDetailedChain,
  scheduleDetailedSingle,
  selectCandidates,
  type CandidateRoute,
  type CandidateSpot,
} from '../../src/services/planner.core';

const origin = { label: 'Origin', lat: 49, lng: -123, placeId: null };
const destination = { label: 'Destination', lat: 49, lng: -122.9, placeId: null };

function spot(id: string, lat: number, lng: number, overrides: Partial<CandidateSpot> = {}): CandidateSpot {
  return {
    _id: id,
    label: id,
    location: { lat, lng },
    placeId: null,
    rateCents: 500,
    ratePer: 'HOUR',
    overnightAllowed: true,
    ...overrides,
  };
}

function route(id: string, overrides: Partial<CandidateRoute> = {}): CandidateRoute {
  return {
    spotId: id,
    label: 'BALANCED',
    leaveAt: new Date('2026-11-02T08:00:00Z'),
    arriveAt: new Date('2026-11-02T09:00:00Z'),
    lateByMinutes: 0,
    parkedFromAt: new Date('2026-11-02T08:30:00Z'),
    totalDurationSeconds: 3600,
    totalDistanceMeters: 12000,
    totalCostCents: 1000,
    costBreakdown: { fuelCents: 200, parkingCents: 500, fareCents: 300 },
    costEstimated: false,
    score: 2000,
    overnightAllowed: true,
    transferPoint: null,
    walkSeconds: 0,
    ...overrides,
  };
}

describe('selectCandidates', () => {
  // Input: spots on the direct path, behind the origin, and beyond the 1.4x detour ellipse
  // Expected: only the on-the-way spot remains
  test('keeps on-the-way spots and drops spots behind the origin', () => {
    const candidates = selectCandidates(origin, destination, [
      spot('on-way', 49, -122.95),
      spot('behind-origin', 49, -123.03),
      spot('far-detour', 49.08, -122.95),
    ]);

    expect(candidates.map(({ label }) => label)).toEqual(['on-way']);
  });

  // Input: ten spots exactly on the trip line
  // Expected: the candidate count is capped at eight
  test('caps candidates at eight closest to the line', () => {
    const spots = Array.from({ length: 10 }, (_, index) => spot(`spot-${index}`, 49, -122.99 + index * 0.008));

    expect(selectCandidates(origin, destination, spots)).toHaveLength(8);
  });
});

describe('scheduleChain', () => {
  // Input: 10-minute drive, 30-minute transit and a deadline 1 hour away
  // Expected: drive arrival plus five minutes is transit departure; arrival meets deadline
  test('schedules backward from arrive-by with the parking buffer', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    const deadline = new Date('2026-11-02T09:00:00Z');
    const schedule = scheduleChain(600, 1800, deadline, now);

    expect(schedule.driveArriveAt.getTime() + 300_000).toBe(schedule.transitDepartAt.getTime());
    expect(schedule.arriveAt.toISOString()).toBe(deadline.toISOString());
    expect(schedule.leaveAt.toISOString()).toBe('2026-11-02T08:15:00.000Z');
    expect(schedule.lateByMinutes).toBe(0);
  });

  describe('scheduleBikeTransit', () => {
    const now = new Date('2026-11-18T15:00:00Z');

    test('includes the bike-to-transit locking buffer in the overall schedule', () => {
      const transitDepartAt = new Date(now.getTime() + 10 * 60_000);
      const transitArriveAt = new Date(transitDepartAt.getTime() + 20 * 60_000);
      const schedule = scheduleBikeTransit(
        'BIKE_TRANSIT',
        300,
        1200,
        transitDepartAt,
        transitArriveAt,
        null,
        now,
        120,
      );
      if (schedule === null) throw new Error('Expected a feasible bike-to-transit schedule');

      expect(schedule).toMatchObject({
        leaveAt: new Date(transitDepartAt.getTime() - 420_000),
        bikeArriveAt: new Date(transitDepartAt.getTime() - 120_000),
        transitDepartAt,
        arriveAt: transitArriveAt,
      });
      expect(schedule.arriveAt.getTime() - schedule.leaveAt.getTime()).toBe((300 + 120 + 1200) * 1000);
    });

    test('includes the transit-to-bike retrieval buffer and bicycle time after transit', () => {
      const transitDepartAt = new Date(now.getTime() + 5 * 60_000);
      const transitArriveAt = new Date(transitDepartAt.getTime() + 20 * 60_000);
      const schedule = scheduleBikeTransit(
        'TRANSIT_BIKE',
        600,
        1200,
        transitDepartAt,
        transitArriveAt,
        null,
        now,
        90,
      );
      if (schedule === null) throw new Error('Expected a feasible transit-to-bike schedule');

      expect(schedule.bikeDepartAt).toEqual(new Date(transitArriveAt.getTime() + 90_000));
      expect(schedule.arriveAt).toEqual(new Date(transitArriveAt.getTime() + 90_000 + 600_000));
      expect(schedule.arriveAt.getTime() - schedule.leaveAt.getTime()).toBe(1200 * 1000 + 90_000 + 600_000);
    });

    test('rejects a bike-to-transit schedule when the connecting service leaves before cycling is possible', () => {
      const schedule = scheduleBikeTransit(
        'BIKE_TRANSIT',
        900,
        600,
        new Date(now.getTime() + 5 * 60_000),
        new Date(now.getTime() + 15 * 60_000),
        null,
        now,
        120,
      );

      expect(schedule).toBeNull();
    });
  });

  // Input: a deadline that cannot be met from now
  // Expected: leave now, then report the rounded-up lateness
  test('returns a late fallback when the deadline is too early', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    const schedule = scheduleChain(600, 1800, new Date('2026-11-02T08:10:00Z'), now);

    expect(schedule.leaveAt.toISOString()).toBe(now.toISOString());
    expect(schedule.lateByMinutes).toBe(35);
  });

  // Input: leave-now plan with no arrive-by date
  // Expected: start immediately and depart transit after driving plus five minutes
  test('starts now when there is no arrive-by time', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    const schedule = scheduleChain(600, 1800, null, now);

    expect(schedule.leaveAt.toISOString()).toBe(now.toISOString());
    expect(schedule.transitDepartAt.toISOString()).toBe('2026-11-02T08:15:00.000Z');
  });

  // Input: detailed transit times later than the screening estimate
  // Expected: preserve Google's exact transit departure and arrival and derive the drive leave-by
  test('refines the chain with exact route-detail timestamps', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    const schedule = scheduleDetailedChain(
      600,
      1800,
      new Date('2026-11-02T08:30:00Z'),
      new Date('2026-11-02T09:00:00Z'),
      new Date('2026-11-02T09:00:00Z'),
      now,
    );

    expect(schedule.leaveAt.toISOString()).toBe('2026-11-02T08:15:00.000Z');
    expect(schedule.driveArriveAt.toISOString()).toBe('2026-11-02T08:25:00.000Z');
    expect(schedule.transitDepartAt.toISOString()).toBe('2026-11-02T08:30:00.000Z');
    expect(schedule.arriveAt.toISOString()).toBe('2026-11-02T09:00:00.000Z');
  });

  // Input: direct route details departing later than now and arriving before the deadline
  // Expected: preserve Google's exact direct route timestamps
  test('refines a baseline with exact route-detail timestamps', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    const schedule = scheduleDetailedSingle(
      1200,
      new Date('2026-11-02T08:05:00Z'),
      new Date('2026-11-02T08:25:00Z'),
      new Date('2026-11-02T08:30:00Z'),
      now,
    );

    expect(schedule.leaveAt.toISOString()).toBe('2026-11-02T08:05:00.000Z');
    expect(schedule.arriveAt.toISOString()).toBe('2026-11-02T08:25:00.000Z');
    expect(schedule.lateByMinutes).toBe(0);
  });
});

describe('priceChain', () => {
  const common = {
    driveDistanceMeters: 10_000,
    transitDistanceMeters: 12_000,
    totalDurationSeconds: 3600,
    parkedSeconds: 3601,
    spot: spot('paid', 49, -122.95),
    vehicle: { make: 'Honda', model: 'Civic', colour: null, litresPer100km: 8 },
    gasCentsPerLitre: 200,
    transit: { fareType: 'ADULT_STORED_VALUE', monthlyPassZones: null } as const,
    transitZones: 1,
    costVsTime: 50,
  };

  // Input: 10 km at 8 L/100 km and 200 cents/L, plus two parking hours and one-zone fare
  // Expected: 160 fuel + 1000 parking + 285 fare = 1445 cents
  test('prices fuel, hourly parking and stored-value fare', () => {
    const priced = priceChain(common);

    expect(priced.costBreakdown).toEqual({ fuelCents: 160, parkingCents: 1000, fareCents: 285 });
    expect(priced.totalCostCents).toBe(1445);
    expect(priced.totalDistanceMeters).toBe(22_000);
    expect(priced.score).toBe(4445);
    expect(priced.costEstimated).toBe(false);
  });

  // Input: daily parking, unknown hourly rate, a covering pass, a non-covering pass and U-Pass
  // Expected: daily flat rate, unknown zero estimate and pass coverage rules
  test('prices daily and unknown parking and transit passes', () => {
    expect(priceChain({ ...common, spot: spot('daily', 49, -122.95, { rateCents: 1200, ratePer: 'DAY' }) }).costBreakdown.parkingCents).toBe(1200);
    const unknown = priceChain({ ...common, spot: spot('unknown', 49, -122.95, { rateCents: null, ratePer: null }) });
    expect(unknown.costBreakdown.parkingCents).toBe(0);
    expect(unknown.costEstimated).toBe(true);
    expect(priceChain({ ...common, transit: { fareType: 'ADULT_MONTHLY_PASS', monthlyPassZones: 2 }, transitZones: 2 }).costBreakdown.fareCents).toBe(0);
    expect(priceChain({ ...common, transit: { fareType: 'ADULT_MONTHLY_PASS', monthlyPassZones: 1 }, transitZones: 2 }).costBreakdown.fareCents).toBe(420);
    expect(priceChain({ ...common, transit: { fareType: 'UPASS', monthlyPassZones: null }, transitZones: 3 }).costBreakdown.fareCents).toBe(0);
    expect(priceChain({ ...common, transit: { fareType: 'CONCESSION_MONTHLY_PASS', monthlyPassZones: null }, transitZones: 3 }).costBreakdown.fareCents).toBe(0);
    expect(priceChain({ ...common, transit: { fareType: 'CONTACTLESS', monthlyPassZones: null }, transitZones: 3 }).costBreakdown.fareCents).toBe(670);
  });

  // Input: missing vehicle and gas price, and concession stored-value fare
  // Expected: regional fuel defaults are used and the result is marked estimated
  test('uses defaults when vehicle or gas price is missing', () => {
    const priced = priceChain({
      ...common,
      vehicle: null,
      gasCentsPerLitre: null,
      transit: { fareType: 'CONCESSION_STORED_VALUE', monthlyPassZones: null },
    });

    expect(priced.costBreakdown.fuelCents).toBe(171);
    expect(priced.costBreakdown.fareCents).toBe(230);
    expect(priced.costEstimated).toBe(true);
  });
});

describe('filterChains', () => {
  // Input: one route leaves before now, one crosses midnight without overnight parking, one walks over ten minutes
  // Expected: all three are removed, while a feasible control route remains
  test('filters early departures, overnight parking and long walks', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    const chains = [
      route('early', { leaveAt: new Date('2026-11-02T07:59:59Z') }),
      route('overnight', {
        leaveAt: new Date('2026-11-02T23:00:00Z'),
        parkedFromAt: new Date('2026-11-02T23:30:00Z'),
        arriveAt: new Date('2026-11-03T00:30:00Z'),
        overnightAllowed: false,
      }),
      route('walk', { walkSeconds: 601 }),
      route('valid'),
    ];

    expect(filterChains(chains, now).map(({ spotId }) => spotId)).toEqual(['valid']);
  });
});

describe('pickThree', () => {
  // Input: four candidates with distinct spots and known cost, duration and score orderings
  // Expected: labels point to the cheapest, fastest and best remaining balanced route
  test('assigns the three labels to distinct spots', () => {
    const picked = pickThree([
      route('cheap', { totalCostCents: 100, score: 8000, totalDurationSeconds: 7200 }),
      route('fast', { totalCostCents: 900, score: 4000, totalDurationSeconds: 1800 }),
      route('balanced', { totalCostCents: 600, score: 2000, totalDurationSeconds: 3600 }),
      route('extra', { totalCostCents: 700, score: 3000, totalDurationSeconds: 4000 }),
    ]);

    expect(picked.map(({ label, spotId }) => [label, spotId])).toEqual([
      ['CHEAPEST', 'cheap'],
      ['FASTEST', 'fast'],
      ['BALANCED', 'balanced'],
    ]);
  });

  // Input: fewer than three unique routes and ties on every ranking metric
  // Expected: one route per spot, deterministic order, no fabricated options
  test('returns fewer than three options and resolves ties deterministically', () => {
    const picked = pickThree([
      route('first', { totalCostCents: 500, totalDurationSeconds: 1000, score: 1000 }),
      route('second', { totalCostCents: 500, totalDurationSeconds: 1000, score: 1000 }),
    ]);

    expect(picked.map(({ label, spotId }) => [label, spotId])).toEqual([['CHEAPEST', 'first'], ['FASTEST', 'second']]);
    expect(pickThree([])).toEqual([]);
  });

  // Input: two late candidates and one on-time candidate
  // Expected: return the on-time candidate and exclude every late route
  test('prefers on-time routes whenever any can meet the deadline', () => {
    const picked = pickThree([
      route('late-cheap', { lateByMinutes: 8, totalCostCents: 100 }),
      route('on-time', { lateByMinutes: 0, totalCostCents: 500 }),
      route('late-fast', { lateByMinutes: 3, totalDurationSeconds: 100 }),
    ]);

    expect(picked.map(({ spotId }) => spotId)).toEqual(['on-time']);
  });

  // Input: only late routes with different arrival times
  // Expected: return only the earliest-arriving route with its lateness retained
  test('returns only the earliest route when every route is late', () => {
    const picked = pickThree([
      route('later', { lateByMinutes: 20, arriveAt: new Date('2026-11-02T09:20:00Z') }),
      route('earlier', { lateByMinutes: 5, arriveAt: new Date('2026-11-02T09:05:00Z') }),
    ]);

    expect(picked.map(({ spotId, lateByMinutes }) => [spotId, lateByMinutes])).toEqual([['earlier', 5]]);
  });
});
describe('transitLowerBoundSeconds and chainLowerBound', () => {
  const ubc = { lat: 49.2606, lng: -123.246 };
  const waterfront = { label: 'Waterfront', lat: 49.2857, lng: -123.111, placeId: null };
  const driver = {
    vehicle: { make: 'Honda', model: 'Civic', colour: null, litresPer100km: 8 },
    transit: { fareType: 'ADULT_STORED_VALUE', monthlyPassZones: null } as const,
    lastGasPrice: { centsPerLitre: 200, savedAt: new Date('2026-11-02T00:00:00Z') },
  };

  // Input: UBC to Waterfront, whose transit ride in the planner's fixtures takes 25 minutes
  // Expected: the lower bound is positive and below that real ride
  test('never exceeds a real transit time', () => {
    const bound = transitLowerBoundSeconds(ubc, waterfront);

    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThan(1500);
  });

  // Input: a 10-minute, 10 km drive to an hourly spot, then the lower-bound ride to Waterfront
  // Expected: time is drive + 5-minute buffer + bound; cost is 160 fuel + one 500-cent hour + the 285-cent one-zone
  //           fare; and both are no more than the same chain priced with a real 25-minute, two-zone ride
  test('is a floor on time, cost and score', () => {
    const paid = spot('paid', ubc.lat, ubc.lng);
    const bound = chainLowerBound({ driveSeconds: 600, driveMeters: 10_000, spot: paid, destination: waterfront, user: driver, costVsTime: 50 });
    const real = priceChain({
      driveDistanceMeters: 10_000,
      transitDistanceMeters: 15_000,
      totalDurationSeconds: 600 + 300 + 1500,
      parkedSeconds: 300 + 1500,
      spot: paid,
      vehicle: driver.vehicle,
      gasCentsPerLitre: 200,
      transit: driver.transit,
      transitZones: 2,
      costVsTime: 50,
    });

    expect(bound.durationSeconds).toBeCloseTo(900 + transitLowerBoundSeconds(ubc, waterfront));
    expect(bound.costCents).toBe(945);
    expect(bound.durationSeconds).toBeLessThanOrEqual(real.totalDurationSeconds);
    expect(bound.costCents).toBeLessThanOrEqual(real.totalCostCents);
    expect(bound.score).toBeLessThanOrEqual(real.score);
  });
});

describe('pruneSpots', () => {
  const transitOnly = { durationSeconds: 1200, costCents: 300, score: 1300 };
  const bound = (id: string, durationSeconds: number, costCents: number, score: number) => ({ id, durationSeconds, costCents, score });

  // Input: against a transit-only baseline, a best-scoring spot, a slower and costlier spot, a slower but cheaper
  //        spot, a faster but costlier spot, and a spot tied with the baseline
  // Expected: only the slower and costlier spot is dropped
  test('drops only spots the baselines beat on time, cost and score', () => {
    const kept = pruneSpots([
      bound('best', 600, 400, 900),
      bound('dominated', 2000, 500, 2500),
      bound('cheaper', 2000, 200, 2200),
      bound('faster', 900, 500, 1400),
      bound('tied', 1200, 300, 1300),
    ], [transitOnly], transitOnly.costCents);

    expect(kept.map(({ id }) => id)).toStrictEqual(['best', 'cheaper', 'faster', 'tied']);
  });

  // Input: a drive-only baseline that is faster and scores better than the spot, and the transit-only cost to compare
  // Expected: the spot is dropped when transit-only is cheaper, and kept when transit-only costs more
  test('takes cost only from the transit-only baseline', () => {
    const driveOnly = { durationSeconds: 900, costCents: 100, score: 1000 };
    const spots = [bound('best', 600, 400, 900), bound('slow', 1500, 500, 2000)];

    expect(pruneSpots(spots, [driveOnly], 300).map(({ id }) => id)).toStrictEqual(['best']);
    expect(pruneSpots(spots, [driveOnly], 600).map(({ id }) => id)).toStrictEqual(['best', 'slow']);
  });

  // Input: a dominated spot with no transit-only baseline, and no spots at all
  // Expected: nothing is pruned on cost without a transit-only cost, and no spots stay no spots
  test('prunes nothing without a transit-only baseline', () => {
    const spots = [bound('dominated', 2000, 500, 2500), bound('worse', 3000, 600, 3500)];

    expect(pruneSpots(spots, [transitOnly], null)).toStrictEqual(spots);
    expect(pruneSpots([], [transitOnly], transitOnly.costCents)).toStrictEqual([]);
  });

  // Input: two spots that the transit-only baseline beats on time, cost and score
  // Expected: the spot with the better bound score is kept so Balanced still has a chain
  test('always keeps the best-scoring spot', () => {
    const kept = pruneSpots([bound('worse', 3000, 600, 3500), bound('better', 2000, 500, 2500)], [transitOnly], transitOnly.costCents);

    expect(kept.map(({ id }) => id)).toStrictEqual(['better']);
  });
});

describe('chooseRoute', () => {
  const choice = (id: string, durationSeconds: number, longestWalkSeconds: number, lines: number) => ({
    id, durationSeconds, longestWalkSeconds, transitLines: Array.from({ length: lines }, () => 'line'),
  });

  // Input: Google's first route walks 12 minutes, and two alternatives fit a 10-minute max walk
  // Expected: the shortest alternative that fits
  test('picks the shortest alternative within the max walk', () => {
    const picked = chooseRoute([choice('long walk', 2400, 720, 1), choice('slow', 4800, 120, 1), choice('quick', 2520, 300, 2)], 600);

    expect(picked?.id).toBe('quick');
  });

  // Input: two routes of the same length, one with fewer transit lines
  // Expected: the one with fewer lines
  test('breaks ties with fewer transit lines', () => {
    expect(chooseRoute([choice('two lines', 1800, 0, 2), choice('one line', 1800, 0, 1)], 600)?.id).toBe('one line');
  });

  // Input: routes that all walk further than the max, and no routes
  // Expected: null
  test('returns null when no route fits', () => {
    expect(chooseRoute([choice('far', 1800, 900, 1)], 600)).toBeNull();
    expect(chooseRoute([], 600)).toBeNull();
  });
});
