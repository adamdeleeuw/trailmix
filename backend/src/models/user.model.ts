import { Schema, model, type Types } from 'mongoose';

/** Colours the questionnaire offers for a car. */
export const COLOURS = [
  'Black', 'White', 'Grey', 'Silver', 'Blue', 'Red', 'Green',
  'Brown', 'Beige', 'Gold', 'Yellow', 'Orange', 'Purple', 'Burgundy',
] as const;

/** How a user pays for transit. Prices live in the fare table, so only the type is stored. */
export const FARE_TYPES = [
  'ADULT_STORED_VALUE',
  'CONCESSION_STORED_VALUE',
  'CONTACTLESS',
  'ADULT_MONTHLY_PASS',
  'CONCESSION_MONTHLY_PASS',
  'UPASS',
] as const;

/** Zones an adult monthly pass can cover. */
export const PASS_ZONES = [1, 2, 3] as const;

/** The gas prices a user can save, in cents per litre. */
export const MIN_CENTS_PER_LITRE = 50;
export const MAX_CENTS_PER_LITRE = 400;

/** The most parking spots a user can save, which keeps the Planner's candidate list bounded. */
export const MAX_PARKING_SPOTS = 20;

/** The shortest and longest name a parking spot can have. */
export const MIN_PARKING_LABEL_LENGTH = 1;
export const MAX_PARKING_LABEL_LENGTH = 60;

/** What a parking spot's rate is charged per. */
export const RATE_UNITS = ['HOUR', 'DAY'] as const;

/** The car a user drives. */
export interface Vehicle {
  make: string; // one of the makes in data/vehicles.json
  model: string; // one of that make's base models
  colour: (typeof COLOURS)[number] | null; // null when not chosen
  litresPer100km: number; // 1.0 to 40.0, one decimal at most
}

/** How a user pays for transit. */
export interface Transit {
  fareType: (typeof FARE_TYPES)[number];
  monthlyPassZones: (typeof PASS_ZONES)[number] | null; // only set for ADULT_MONTHLY_PASS
}

/** The last gas price a user saved. Kept when they stop driving, but hidden by the app. */
export interface GasPrice {
  centsPerLitre: number; // 50.0 to 400.0, one decimal at most
  savedAt: Date; // set by the server when the price is saved
}

/** A point on the map, in the WGS84 coordinate system. */
export interface LatLng {
  lat: number; // -90 to 90
  lng: number; // -180 to 180
}

/** What a parking spot costs, as the user entered it. */
export interface ParkingRate {
  rateCents: number | null; // whole cents, null when the cost is unknown
  ratePer: (typeof RATE_UNITS)[number] | null; // null exactly when rateCents is null
}

/** The parts of a parking spot the user can change after saving it. */
export interface ParkingSpotDetails extends ParkingRate {
  label: string; // 1 to 60 characters, without leading or trailing spaces
  overnightAllowed: boolean; // false when the user turned on "No overnight parking"
}

/** A new parking spot, before the server gives it an ID and a time. */
export interface NewParkingSpot extends ParkingSpotDetails {
  location: LatLng;
  placeId: string | null; // Google place ID when it came from search, null for a dropped pin
}

/**
 * A place where the user parks before switching to transit. The Planner only
 * hands off from driving at these.
 */
export interface ParkingSpot extends NewParkingSpot {
  _id: Types.ObjectId; // used in the edit and delete paths
  createdAt: Date; // set by the server when the spot is saved
}

/** The parking spot fields the app is allowed to see. */
export interface ParkingSpotResponse extends NewParkingSpot {
  id: string;
  createdAt: string; // ISO 8601 date
}

/** The commute questionnaire's answers. Saving always replaces all of them. */
export interface Profile {
  timezone: string; // IANA name from the device, e.g. "America/Vancouver"
  vehicle: Vehicle | null; // null when the user doesn't drive
  transit: Transit | null; // null when the user doesn't take transit
}

/**
 * A Trailmix account, stored in the `users` collection.
 *
 * @remarks
 * Users are identified by their Google account ID (`googleId`), never by email,
 * because a Google account's email can change but its ID can't. The unique index
 * on `googleId` makes the database refuse a second account for the same Google
 * account, even when two sign-ins race.
 */
export interface User {
  _id: Types.ObjectId;
  googleId: string; // Google's `sub` claim for the account
  email: string; // refreshed from Google on every sign-in
  name: string; // refreshed from Google on every sign-in
  photoUrl: string | null; // Google profile photo, refreshed on every sign-in (null if Google has none)
  profileComplete: boolean; // whether the commute questionnaire has been submitted
  timezone: string | null; // null until the questionnaire is submitted
  vehicle: Vehicle | null;
  transit: Transit | null;
  lastGasPrice: GasPrice | null; // null until a price is saved
  parkingSpots: ParkingSpot[]; // newest first, at most MAX_PARKING_SPOTS
  createdAt: Date;
  updatedAt: Date;
}

/** The account fields the app is allowed to see. */
export interface UserResponse {
  id: string;
  email: string;
  name: string;
  photoUrl: string | null;
  profileComplete: boolean;
  timezone: string | null;
  vehicle: Vehicle | null;
  transit: Transit | null;
  lastGasPrice: { centsPerLitre: number; savedAt: string } | null; // savedAt is an ISO 8601 date
}

// _id: false because there's only ever one of each, inside the user
const vehicleSchema = new Schema<Vehicle>(
  {
    make: { type: String, required: true },
    model: { type: String, required: true },
    colour: { type: String, enum: COLOURS, default: null },
    litresPer100km: { type: Number, required: true, min: 1, max: 40 },
  },
  { _id: false },
);

const transitSchema = new Schema<Transit>(
  {
    fareType: { type: String, enum: FARE_TYPES, required: true },
    monthlyPassZones: { type: Number, enum: PASS_ZONES, default: null },
  },
  { _id: false },
);

const gasPriceSchema = new Schema<GasPrice>(
  {
    centsPerLitre: { type: Number, required: true, min: MIN_CENTS_PER_LITRE, max: MAX_CENTS_PER_LITRE },
    savedAt: { type: Date, required: true },
  },
  { _id: false },
);

const latLngSchema = new Schema<LatLng>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false },
);

// keeps an _id, unlike the schemas above, because the app edits and deletes spots by ID
const parkingSpotSchema = new Schema<ParkingSpot>({
  label: { type: String, required: true, minlength: MIN_PARKING_LABEL_LENGTH, maxlength: MAX_PARKING_LABEL_LENGTH },
  location: { type: latLngSchema, required: true },
  placeId: { type: String, default: null },
  rateCents: { type: Number, default: null, min: 0 },
  ratePer: { type: String, enum: RATE_UNITS, default: null },
  overnightAllowed: { type: Boolean, required: true },
  createdAt: { type: Date, required: true },
});

const userSchema = new Schema<User>(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
    photoUrl: { type: String, default: null },
    profileComplete: { type: Boolean, required: true, default: false },
    timezone: { type: String, default: null },
    vehicle: { type: vehicleSchema, default: null },
    transit: { type: transitSchema, default: null },
    lastGasPrice: { type: gasPriceSchema, default: null },
    parkingSpots: { type: [parkingSpotSchema], default: [] },
  },
  { timestamps: true },
);

export const UserModel = model<User>('User', userSchema); // Mongoose model for the users collection

/**
 * Converts a stored user into the shape sent to the app.
 *
 * @param user - The stored user.
 * @returns The public account fields, without `googleId` or timestamps.
 */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    photoUrl: user.photoUrl,
    profileComplete: user.profileComplete,
    timezone: user.timezone,
    vehicle: user.vehicle && {
      make: user.vehicle.make,
      model: user.vehicle.model,
      colour: user.vehicle.colour,
      litresPer100km: user.vehicle.litresPer100km,
    },
    transit: user.transit && {
      fareType: user.transit.fareType,
      monthlyPassZones: user.transit.monthlyPassZones,
    },
    lastGasPrice: user.lastGasPrice && {
      centsPerLitre: user.lastGasPrice.centsPerLitre,
      savedAt: user.lastGasPrice.savedAt.toISOString(),
    },
  };
}

/**
 * Converts a stored parking spot into the shape sent to the app.
 *
 * @param spot - The stored parking spot.
 * @returns The spot with its ID as a string and its time as an ISO 8601 date.
 */
export function toParkingSpotResponse(spot: ParkingSpot): ParkingSpotResponse {
  return {
    id: spot._id.toString(),
    label: spot.label,
    location: { lat: spot.location.lat, lng: spot.location.lng },
    placeId: spot.placeId,
    rateCents: spot.rateCents,
    ratePer: spot.ratePer,
    overnightAllowed: spot.overnightAllowed,
    createdAt: spot.createdAt.toISOString(),
  };
}
