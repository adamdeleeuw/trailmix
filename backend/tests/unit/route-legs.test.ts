import { decodePolyline } from '../helpers/polyline';
import { normalizeRouteLegs, type NormalizableLeg } from '../../src/services/route-legs';

const ORIGIN = { label: 'Shannon Park', lat: 49, lng: -123, placeId: null };
const DESTINATION = { label: 'UBC Exchange Bay 1', lat: 49.01, lng: -123.01, placeId: null };
const FIRST_SEGMENT = '???A';
const SECOND_SEGMENT = '?AA?';
const THIRD_SEGMENT = 'AAA?';

function leg(
  mode: NormalizableLeg['mode'],
  polyline = FIRST_SEGMENT,
  durationSeconds = 120,
  distanceMeters = 100,
  fromLabel = '',
  toLabel = '',
): NormalizableLeg {
  return {
    mode,
    from: { label: fromLabel, lat: ORIGIN.lat, lng: ORIGIN.lng, placeId: null },
    to: { label: toLabel, lat: DESTINATION.lat, lng: DESTINATION.lng, placeId: null },
    departAt: '2026-11-02T16:00:00.000Z',
    arriveAt: new Date(Date.parse('2026-11-02T16:00:00.000Z') + durationSeconds * 1000).toISOString(),
    durationSeconds,
    distanceMeters,
    costCents: 0,
    polyline,
    transitLines: mode === 'TRANSIT'
      ? [{
        name: '99 B-Line',
        shortName: '',
        vehicle: 'Bus',
        colour: '#00843D',
        headsign: 'UBC',
        departureStop: 'UBC Exchange Bay 1',
        arrivalStop: 'Downtown',
        stopCount: 8,
      }]
      : [],
  };
}

function totals(legs: readonly NormalizableLeg[]) {
  return legs.reduce((sum, item) => ({
    durationSeconds: sum.durationSeconds + item.durationSeconds,
    distanceMeters: sum.distanceMeters + item.distanceMeters,
    costCents: sum.costCents + item.costCents,
  }), { durationSeconds: 0, distanceMeters: 0, costCents: 0 });
}

describe('Unmocked: normalizeRouteLegs', () => {
  // Input: three consecutive walking steps with connected encoded geometry
  // Expected status code: N/A (pure function)
  // Expected output: one walk with summed fields, original endpoints, and a continuous re-encoded polyline
  // Mock behavior: none
  test('merges consecutive walks and concatenates decoded geometry', () => {
    const walks = [
      leg('WALK', FIRST_SEGMENT, 20, 20, 'Origin', ''),
      leg('WALK', SECOND_SEGMENT, 30, 30),
      leg('WALK', THIRD_SEGMENT, 40, 40, '', 'End'),
    ];

    const [merged] = normalizeRouteLegs(walks, ORIGIN, DESTINATION);

    expect(merged).toMatchObject({
      mode: 'WALK',
      durationSeconds: 90,
      distanceMeters: 90,
      from: { label: 'Origin' },
      to: { label: 'End' },
    });
    expect(merged?.polyline).toBe('???AA?A?');
    expect(decodePolyline(merged?.polyline ?? '')).toEqual([
      [0, 0],
      [0, 0.00001],
      [0.00001, 0.00001],
      [0.00002, 0.00001],
    ]);
  });

  // Input: a single non-trivial walking leg
  // Expected status code: N/A (pure function)
  // Expected output: one walk with its geometry and timing unchanged
  // Mock behavior: none
  test('leaves a single walk alone', () => {
    const walk = leg('WALK', FIRST_SEGMENT, 120, 100, 'Origin', 'Destination');

    expect(normalizeRouteLegs([walk], ORIGIN, DESTINATION)).toEqual([walk]);
  });

  // Input: walks separated by transit and drive legs
  // Expected status code: N/A (pure function)
  // Expected output: no walk is merged across either non-walk leg
  // Mock behavior: none
  test('does not merge walks separated by transit or drive', () => {
    const input = [
      leg('WALK', FIRST_SEGMENT, 120, 100, 'A', 'B'),
      leg('TRANSIT', FIRST_SEGMENT, 300, 500, 'B', 'C'),
      leg('WALK', FIRST_SEGMENT, 120, 100, 'C', 'D'),
      leg('DRIVE', FIRST_SEGMENT, 300, 500, 'D', 'E'),
      leg('WALK', FIRST_SEGMENT, 120, 100, 'E', 'F'),
    ];

    expect(normalizeRouteLegs(input, ORIGIN, DESTINATION).map(({ mode }) => mode))
      .toEqual(['WALK', 'TRANSIT', 'WALK', 'DRIVE', 'WALK']);
  });

  // Input: a 30-second, 20-metre walk immediately before a transit leg
  // Expected status code: N/A (pure function)
  // Expected output: the walk is absorbed into transit with geometry, duration, and distance retained
  // Mock behavior: none
  test('absorbs a trivial walk into the next leg', () => {
    const input = [
      leg('WALK', FIRST_SEGMENT, 30, 20, 'Origin', ''),
      leg('TRANSIT', SECOND_SEGMENT, 300, 500, '', 'Destination'),
    ];

    const [merged] = normalizeRouteLegs(input, ORIGIN, DESTINATION);

    expect(merged).toMatchObject({ mode: 'TRANSIT', durationSeconds: 330, distanceMeters: 520 });
    expect(merged?.from.label).toBe('Origin');
    expect(decodePolyline(merged?.polyline ?? '')).toHaveLength(3);
    expect(totals([merged].filter((item): item is NormalizableLeg => item !== undefined))).toEqual(totals(input));
  });

  // Input: a walk followed by a transit leg whose departure stop has a useful label
  // Expected status code: N/A (pure function)
  // Expected output: the walk destination uses the boarding stop, and no endpoint says "Transit connection"
  // Mock behavior: none
  test('uses nearby stops and journey endpoints instead of generic connection labels', () => {
    const input = [
      leg('WALK', FIRST_SEGMENT, 120, 100, 'Transit connection', 'Transit connection'),
      leg('TRANSIT', SECOND_SEGMENT, 300, 500, 'Transit connection', 'Transit connection'),
    ];

    const normalized = normalizeRouteLegs(input, ORIGIN, DESTINATION);

    expect(normalized[0]?.to.label).toBe('UBC Exchange Bay 1');
    expect(normalized.flatMap(({ from, to }) => [from.label, to.label]))
      .not.toContain('Transit connection');
  });

  // Input: consecutive walks plus a transit leg, before and after normalization
  // Expected status code: N/A (pure function)
  // Expected output: total duration, distance, and cost are identical
  // Mock behavior: none
  test('preserves duration, distance, and cost totals', () => {
    const input = [
      { ...leg('WALK', FIRST_SEGMENT, 20, 10), costCents: 1 },
      { ...leg('WALK', SECOND_SEGMENT, 30, 20), costCents: 2 },
      { ...leg('TRANSIT', THIRD_SEGMENT, 300, 500), costCents: 285 },
    ];

    expect(totals(normalizeRouteLegs(input, ORIGIN, DESTINATION))).toEqual(totals(input));
  });
});
