import type { Transit } from '../models/user.model';

// Default gas and vehicle values are provisional CP2 assumptions: issue #72
// requires regional defaults but provides no numeric source or values. Checked 2026-11-02;
// replace with a verified local source before treating estimated costs as authoritative.
export const DEFAULT_GAS_CENTS_PER_LITRE = 190;
export const DEFAULT_LITRES_PER_100KM = 9;

// Fare values are whole cents from TransLink's Pricing and Fare Zones page,
// checked 2026-11-02: https://www.translink.ca/transit-fares/pricing-and-fare-zones
export const STORED_VALUE_FARES: Readonly<Record<'ADULT' | 'CONCESSION' | 'CONTACTLESS', readonly [number, number, number]>> = {
  ADULT: [285, 420, 540],
  CONCESSION: [230, 340, 460],
  CONTACTLESS: [350, 510, 670],
};

export function singleTransitFareCents(transit: Transit | null, zones: number): number {
  if (transit?.fareType === 'UPASS') return 0;
  if (transit?.fareType === 'CONCESSION_MONTHLY_PASS') return 0;
  if (transit?.fareType === 'ADULT_MONTHLY_PASS' && (transit.monthlyPassZones ?? 0) >= zones) return 0;

  const tier: 0 | 1 | 2 = zones <= 1 ? 0 : zones >= 3 ? 2 : 1;
  if (transit?.fareType === 'CONCESSION_STORED_VALUE') return STORED_VALUE_FARES.CONCESSION[tier];
  if (transit?.fareType === 'ADULT_STORED_VALUE' || transit?.fareType === 'ADULT_MONTHLY_PASS') {
    return STORED_VALUE_FARES.ADULT[tier];
  }
  return STORED_VALUE_FARES.CONTACTLESS[tier];
}