/**
 * The 10 demo commutes the Map tab's "Load demo trips" button adds, so History and
 * Commute Insights have something to show on a new account.
 *
 * @remarks
 * Same trips as `scripts/seed-trips.js`, which seeds a local database by hand. Keep
 * the two in step. Amounts are whole cents, seconds and metres, as `Trip` requires.
 */
import type { Leg, Place, TransitLine } from '../models/trip.model';

const place = (label: string, lat: number, lng: number): Place => ({ label, lat, lng, placeId: null });
const HOME = place('Home, Surrey', 49.1913, -122.849);
const SURREY_CENTRAL = place('Surrey Central Station', 49.1894, -122.8476);
const UBC = place('UBC', 49.2606, -123.246);
const WORK = place('Downtown Vancouver', 49.2827, -123.1207);
const WATERFRONT = place('Waterfront Station', 49.2859, -123.1117);

// non-empty placeholder (Google's documented example polyline); the app doesn't draw saved trips
const POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

const BLINE: TransitLine[] = [{ name: '99 B-Line', vehicle: 'Bus' }];
const SKYTRAIN: TransitLine[] = [{ name: 'Expo Line', vehicle: 'SkyTrain' }];

const driveLeg = (from: Place, to: Place, durationSeconds: number, distanceMeters: number, costCents: number): Leg => ({
  mode: 'DRIVE', from, to, durationSeconds, distanceMeters, costCents, polyline: POLYLINE, transitLines: [],
});

const transitLeg = (
  from: Place,
  to: Place,
  durationSeconds: number,
  distanceMeters: number,
  costCents: number,
  transitLines: TransitLine[],
): Leg => ({
  mode: 'TRANSIT', from, to, durationSeconds, distanceMeters, costCents, polyline: POLYLINE, transitLines,
});

/** One demo commute, dated relative to when it is seeded. */
export interface DemoTrip {
  daysAgo: number;
  origin: Place;
  midpoint: Place | null; // null for a direct trip
  destination: Place;
  legs: Leg[];
}

const demo = (daysAgo: number, origin: Place, midpoint: Place | null, destination: Place, legs: Leg[]): DemoTrip => ({
  daysAgo, origin, midpoint, destination, legs,
});

export const DEMO_TRIPS: readonly DemoTrip[] = [
  demo(1, HOME, SURREY_CENTRAL, UBC,
    [driveLeg(HOME, SURREY_CENTRAL, 660, 4200, 64), transitLeg(SURREY_CENTRAL, UBC, 3300, 31000, 335, BLINE)]),
  demo(3, HOME, SURREY_CENTRAL, WORK,
    [driveLeg(HOME, SURREY_CENTRAL, 600, 4200, 64), transitLeg(SURREY_CENTRAL, WATERFRONT, 2400, 27000, 335, SKYTRAIN)]),
  demo(5, HOME, SURREY_CENTRAL, UBC,
    [driveLeg(HOME, SURREY_CENTRAL, 780, 4300, 66), transitLeg(SURREY_CENTRAL, UBC, 3600, 31000, 335, BLINE)]),
  demo(8, HOME, null, WORK,
    [driveLeg(HOME, WORK, 2700, 32000, 486)]),
  demo(12, HOME, SURREY_CENTRAL, WORK,
    [driveLeg(HOME, SURREY_CENTRAL, 540, 4100, 62), transitLeg(SURREY_CENTRAL, WATERFRONT, 2520, 27000, 335, SKYTRAIN)]),
  demo(18, HOME, SURREY_CENTRAL, UBC,
    [driveLeg(HOME, SURREY_CENTRAL, 720, 4200, 64), transitLeg(SURREY_CENTRAL, UBC, 3420, 31000, 335, BLINE)]),
  demo(25, SURREY_CENTRAL, null, WORK,
    [transitLeg(SURREY_CENTRAL, WATERFRONT, 2400, 27000, 335, SKYTRAIN)]),
  demo(33, HOME, SURREY_CENTRAL, UBC,
    [driveLeg(HOME, SURREY_CENTRAL, 630, 4200, 64), transitLeg(SURREY_CENTRAL, UBC, 3180, 31000, 335, BLINE)]),
  demo(45, HOME, SURREY_CENTRAL, WORK,
    [driveLeg(HOME, SURREY_CENTRAL, 690, 4300, 66), transitLeg(SURREY_CENTRAL, WATERFRONT, 2580, 27000, 335, SKYTRAIN)]),
  demo(58, HOME, null, UBC,
    [driveLeg(HOME, UBC, 3000, 45000, 684)]),
];
