import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/** Travel modes supported by a trip leg. */
export const TRIP_MODES = ['DRIVE', 'TRANSIT'] as const;

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
  vehicle: string; // e.g. bus, SkyTrain, or SeaBus
}

/** One driving or transit segment of a trip. */
export interface Leg {
  mode: (typeof TRIP_MODES)[number];
  from: Place;
  to: Place;
  durationSeconds: number; // non-negative whole seconds
  distanceMeters: number; // non-negative whole metres
  costCents: number; // non-negative whole cents
  polyline: string; // encoded route geometry
  transitLines: TransitLine[]; // empty for a driving leg
}

/** A saved commute, stored in the `trips` collection. */
export interface Trip {
  _id: Types.ObjectId;
  userId: Types.ObjectId; // user who owns the trip
  origin: Place;
  midpoint: Place | null; // optional transfer point
  destination: Place;
  legs: Leg[]; // one direct leg or two chained legs
  totalDurationSeconds: number; // sum of leg durations
  totalCostCents: number; // sum of leg costs
  tripDate: Date; // date of the commute
  seeded: boolean; // whether the trip was generated as demo data
  createdAt: Date;
  updatedAt: Date;
}

/** The trip fields the app is allowed to see. */
export interface TripResponse {
  id: string;
  origin: Place;
  midpoint: Place | null;
  destination: Place;
  legs: Leg[];
  totalDurationSeconds: number;
  totalCostCents: number;
  tripDate: Date;
}

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
    vehicle: { type: String, required: true },
  },
  { _id: false },
);

const legSchema = new Schema<Leg>(
  {
    mode: { type: String, enum: TRIP_MODES, required: true },
    from: { type: placeSchema, required: true },
    to: { type: placeSchema, required: true },
    durationSeconds: { type: Number, required: true, min: 0, validate: Number.isInteger },
    distanceMeters: { type: Number, required: true, min: 0, validate: Number.isInteger },
    costCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
    polyline: { type: String, required: true },
    transitLines: { type: [transitLineSchema], default: [] },
  },
  { _id: false },
);

const tripSchema = new Schema<Trip>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    origin: { type: placeSchema, required: true },
    midpoint: { type: placeSchema, default: null },
    destination: { type: placeSchema, required: true },
    legs: {
      type: [legSchema],
      required: true,
      validate: { validator: (legs: Leg[]) => legs.length >= 1 && legs.length <= 2 },
    },
    totalDurationSeconds: { type: Number, required: true, min: 0, validate: Number.isInteger },
    totalCostCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
    tripDate: { type: Date, required: true, default: Date.now },
    seeded: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

tripSchema.index({ userId: 1, tripDate: -1 });

tripSchema.pre('validate', function validateLegTotals(this: HydratedDocument<Trip>) {
  const totalDurationSeconds = this.legs.reduce((sum: number, leg: Leg) => sum + leg.durationSeconds, 0);
  const totalCostCents = this.legs.reduce((sum: number, leg: Leg) => sum + leg.costCents, 0);
  if (totalDurationSeconds !== this.totalDurationSeconds) {
    this.invalidate('totalDurationSeconds', 'Must equal the sum of leg durations');
  }
  if (totalCostCents !== this.totalCostCents) {
    this.invalidate('totalCostCents', 'Must equal the sum of leg costs');
  }
});

export const TripModel = model<Trip>('Trip', tripSchema); // Mongoose model for the trips collection

/**
 * Converts a stored trip into the shape sent to the app.
 *
 * @param trip - The stored trip.
 * @returns The public trip fields, without `userId`, `seeded`, or timestamps.
 */
export function toTripResponse(trip: Trip): TripResponse {
  return {
    id: trip._id.toString(),
    origin: trip.origin,
    midpoint: trip.midpoint,
    destination: trip.destination,
    legs: trip.legs,
    totalDurationSeconds: trip.totalDurationSeconds,
    totalCostCents: trip.totalCostCents,
    tripDate: trip.tripDate,
  };
}