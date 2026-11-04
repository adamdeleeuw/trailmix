import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/** Travel modes supported by a trip leg. */
export const TRIP_MODES = ['DRIVE', 'TRANSIT', 'WALK'] as const;

/** Where a trip is in its lifecycle, from saved for later to finished. */
const TRIP_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

type TripMode = typeof TRIP_MODES[number];
export type TripStatus = typeof TRIP_STATUSES[number];

export const MAX_LEGS = 8; // Bound # of legs, but allow for realistic uses

/** A place included in a saved trip. */
export interface Place {
  label: string; // user-facing place name
  lat: number; // latitude in the WGS84 coordinate system
  lng: number; // longitude in the WGS84 coordinate system
  placeId: string | null; // optional provider place identifier
}

/** A transit line used by a trip leg. */
export interface TransitLine {
  name: string; // route or line name
  shortName: string | null; // what the line is signed as, e.g. "99", '' or null when it has none (SkyTrain lines, older trips)
  vehicle: string; // e.g. bus, SkyTrain, or SeaBus
  colour: string | null; // hex colour from Google, which sometimes omits it
  headsign: string | null; // direction shown on the vehicle, e.g. "King George"
  departureStop: string | null;
  arrivalStop: string | null;
  stopCount: number | null; // stops ridden, null for trips saved before CP2
}

/** One turn-by-turn instruction on a driving or walking leg, for in-app navigation. */
export interface NavigationStep {
  instruction: string; // Google's text, e.g. "Turn left onto W 16th Ave"
  maneuver: string; // Google's maneuver name, e.g. "TURN_LEFT", which picks the app's arrow
  lat: number; // where the maneuver happens (the start of Google's step)
  lng: number;
}

/** One driving, transit or walking segment of a trip. */
export interface Leg {
  mode: TripMode;
  from: Place;
  to: Place;
  departAt: Date | null; // null for trips saved before CP2
  arriveAt: Date | null;
  durationSeconds: number; // non-negative whole seconds
  distanceMeters: number; // non-negative whole metres
  costCents: number; // non-negative whole cents
  polyline: string; // encoded route geometry
  transitLines: TransitLine[]; // empty for a driving or walking leg
  steps: NavigationStep[]; // turn-by-turn for a driving or walking leg, empty for transit and for older trips
}

/** How a trip's total cost splits into fuel, parking and transit fares, in whole cents. */
export interface CostBreakdown {
  fuelCents: number;
  parkingCents: number;
  fareCents: number;
}

/** A saved commute, stored in the `trips` collection. */
export interface Trip {
  _id: Types.ObjectId;
  userId: Types.ObjectId; // user who owns the trip
  status: TripStatus;
  origin: Place;
  midpoint: Place | null; // the one transfer point of trips saved before CP2, replaced by transferPoints
  destination: Place;
  transferPoints: Place[]; // the parking spot for Drive → Transit, else empty
  legs: Leg[];
  totalDurationSeconds: number; // leave to arrive, so it includes any waiting between legs
  totalDistanceMeters: number | undefined; // sum of leg distances, undefined only on trips saved before CP2
  totalCostCents: number; // sum of leg costs
  costBreakdown: CostBreakdown;
  costEstimated: boolean; // whether any part of the cost used a default
  baselineDriveCostCents: number | null; // cost of driving the whole way, for "saved vs driving"
  arriveBy: Date | null; // null when the user chose "leave now"
  plannedStart: Date | null; // the route's leaveAt, null for trips saved before CP2
  plannedEnd: Date | null; // the route's arriveAt
  actualStart: Date | null; // set by the server when the trip starts
  actualEnd: Date | null; // set by the server when the trip ends
  tripDate: Date; // date of the commute
  seeded: boolean; // whether the trip was generated as demo data
  createdAt: Date;
  updatedAt: Date;
}

/** A trip the app saves from a planned route, before the server adds its owner and date. */
export type NewTrip = Pick<
  Trip,
  'origin' | 'destination' | 'transferPoints' | 'legs' | 'totalDurationSeconds' | 'totalCostCents'
  | 'costBreakdown' | 'costEstimated' | 'baselineDriveCostCents' | 'arriveBy' | 'actualStart'
> & {
  status: 'PLANNED' | 'ACTIVE'; // a trip can't be saved already finished
  totalDistanceMeters: number;
  plannedStart: Date;
  plannedEnd: Date;
};

/** A status change the app asks for on a saved trip, and when it happened. */
export interface TripStatusChange {
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  at: Date; // becomes actualStart when starting, actualEnd when ending
}

/** The trip fields the app is allowed to see. */
export interface TripResponse {
  id: string;
  status: TripStatus;
  origin: Place;
  destination: Place;
  transferPoints: Place[];
  legs: Leg[];
  totalDurationSeconds: number;
  totalDistanceMeters: number;
  totalCostCents: number;
  costBreakdown: CostBreakdown;
  costEstimated: boolean;
  baselineDriveCostCents: number | null;
  arriveBy: Date | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  tripDate: Date;
}

/** Accepts null or a whole number, for optional counts and cents. */
const isWholeOrNull = (value: number | null) => value === null || Number.isInteger(value);

const placeSchema = new Schema<Place>(
  {
    label: { type: String, required: true },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    placeId: { type: String, default: null },
  },
  { _id: false },
);

const transitLineSchema = new Schema<TransitLine>(
  {
    name: { type: String, required: true },
    shortName: { type: String, default: null },
    vehicle: { type: String, required: true },
    colour: { type: String, default: null },
    headsign: { type: String, default: null },
    departureStop: { type: String, default: null },
    arrivalStop: { type: String, default: null },
    stopCount: { type: Number, default: null, min: 0, validate: isWholeOrNull },
  },
  { _id: false },
);

const navigationStepSchema = new Schema<NavigationStep>(
  {
    instruction: { type: String, required: true },
    maneuver: { type: String, required: true },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false },
);

const legSchema = new Schema<Leg>(
  {
    mode: { type: String, enum: TRIP_MODES, required: true },
    from: { type: placeSchema, required: true },
    to: { type: placeSchema, required: true },
    departAt: { type: Date, default: null },
    arriveAt: { type: Date, default: null },
    durationSeconds: { type: Number, required: true, min: 0, validate: Number.isInteger },
    distanceMeters: { type: Number, required: true, min: 0, validate: Number.isInteger },
    costCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
    polyline: { type: String, required: true },
    transitLines: { type: [transitLineSchema], default: [] },
    steps: { type: [navigationStepSchema], default: [] },
  },
  { _id: false },
);

const costBreakdownSchema = new Schema<CostBreakdown>(
  {
    fuelCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
    parkingCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
    fareCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
  },
  { _id: false },
);

// Mongoose fills these defaults in when it loads a trip saved before CP2, so old trips read without a migration
const tripSchema = new Schema<Trip>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: TRIP_STATUSES, required: true, default: 'COMPLETED' }, // old trips were all finished commutes
    origin: { type: placeSchema, required: true },
    midpoint: { type: placeSchema, default: null },
    destination: { type: placeSchema, required: true },
    transferPoints: { type: [placeSchema], default: [] },
    legs: {
      type: [legSchema],
      required: true,
      validate: { validator: (legs: Leg[]) => legs.length >= 1 && legs.length <= MAX_LEGS },
    },
    totalDurationSeconds: { type: Number, required: true, min: 0, validate: Number.isInteger },
    totalDistanceMeters: { type: Number, min: 0, validate: Number.isInteger }, // no default, so toTripResponse can tell an old trip apart
    totalCostCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
    costBreakdown: {
      type: costBreakdownSchema,
      default: () => ({ fuelCents: 0, parkingCents: 0, fareCents: 0 }), // a function, so trips don't share one object
    },
    costEstimated: { type: Boolean, default: false },
    baselineDriveCostCents: { type: Number, default: null, min: 0, validate: isWholeOrNull },
    arriveBy: { type: Date, default: null },
    plannedStart: { type: Date, default: null },
    plannedEnd: { type: Date, default: null },
    actualStart: { type: Date, default: null },
    actualEnd: { type: Date, default: null },
    tripDate: { type: Date, required: true, default: Date.now },
    seeded: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

tripSchema.index({ userId: 1, tripDate: -1 });
// the database refuses a second ACTIVE trip per user, even if two Start requests race
tripSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } });

/** Sums the distances of a trip's legs. */
const sumLegDistances = (legs: Leg[]) => legs.reduce((sum: number, leg: Leg) => sum + leg.distanceMeters, 0);

// runs on create and save only, and status changes use findOneAndUpdate, so old trips never reach it
tripSchema.pre('validate', function validateLegTotals(this: HydratedDocument<Trip>) {
  const totalCostCents = this.legs.reduce((sum: number, leg: Leg) => sum + leg.costCents, 0);
  const { fuelCents, parkingCents, fareCents } = this.costBreakdown;
  if (sumLegDistances(this.legs) !== this.totalDistanceMeters) {
    this.invalidate('totalDistanceMeters', 'Must equal the sum of leg distances');
  }
  if (totalCostCents !== this.totalCostCents) {
    this.invalidate('totalCostCents', 'Must equal the sum of leg costs');
  }
  if (fuelCents + parkingCents + fareCents !== this.totalCostCents) {
    this.invalidate('costBreakdown', 'Must add up to the total cost');
  }
});

export const TripModel = model<Trip>('Trip', tripSchema); // Mongoose model for the trips collection

/**
 * Converts a stored trip into the shape sent to the app.
 *
 * @remarks
 * Trips saved before CP2 have one `midpoint` and no stored distance, so they are sent
 * with `transferPoints: [midpoint]` and the sum of their leg distances.
 *
 * @param trip - The stored trip.
 * @returns The public trip fields, without `userId`, `seeded`, `midpoint`, or timestamps.
 */
export function toTripResponse(trip: Trip): TripResponse {
  return {
    id: trip._id.toString(),
    status: trip.status,
    origin: trip.origin,
    destination: trip.destination,
    transferPoints: trip.transferPoints.length === 0 && trip.midpoint !== null ? [trip.midpoint] : trip.transferPoints,
    legs: trip.legs,
    totalDurationSeconds: trip.totalDurationSeconds,
    totalDistanceMeters: trip.totalDistanceMeters ?? sumLegDistances(trip.legs),
    totalCostCents: trip.totalCostCents,
    costBreakdown: trip.costBreakdown,
    costEstimated: trip.costEstimated,
    baselineDriveCostCents: trip.baselineDriveCostCents,
    arriveBy: trip.arriveBy,
    plannedStart: trip.plannedStart,
    plannedEnd: trip.plannedEnd,
    actualStart: trip.actualStart,
    actualEnd: trip.actualEnd,
    tripDate: trip.tripDate,
  };
}
