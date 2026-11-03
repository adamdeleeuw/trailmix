import { zonesForTransitLines } from '../../src/services/transit-zones';
import type { TransitLineDetail } from '../../src/services/planner.google.service';

function line(overrides: Partial<TransitLineDetail> = {}): TransitLineDetail {
  return {
    name: 'Expo Line',
    vehicle: 'SkyTrain',
    colour: '#0067A0',
    headsign: 'King George',
    departureStop: 'Waterfront',
    arrivalStop: 'Surrey Central',
    stopCount: 12,
    ...overrides,
  };
}

describe('zonesForTransitLines', () => {
  // Input: a SkyTrain line whose known endpoints are in zones one and three
  // Expected: three fare zones
  test('counts known SkyTrain fare zones', () => {
    expect(zonesForTransitLines([line()])).toBe(3);
  });

  // Input: a bus line or an unknown SkyTrain station
  // Expected: one zone as the documented fallback
  test('uses one zone for buses and unknown station endpoints', () => {
    expect(zonesForTransitLines([line({ name: '99', vehicle: 'Bus' })])).toBe(1);
    expect(zonesForTransitLines([line({ departureStop: 'Unknown station' })])).toBe(1);
  });

  // Input: no transit line details
  // Expected: one-zone fallback
  test('defaults empty routes to one zone', () => {
    expect(zonesForTransitLines([])).toBe(1);
  });
});