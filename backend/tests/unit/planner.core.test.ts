import {
  filterChains,
  pickThree,
  priceChain,
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