// Seeds 10 demo trips for one user. Run through mongosh (see seed-trips.ps1).
// The app's "Load demo trips" button (POST /api/users/me/trips/seed) adds the same
// trips from backend/src/data/demo-trips.ts; keep the two in step.
// Expects FILTER to be defined before this runs, e.g.
//   const FILTER = { googleId: "123..." };   or   { email: "me@gmail.com" }
// Matches src/models/trip.model.ts: integer cents/seconds/metres, non-empty
// polyline, nullable midpoint, totals equal to the sum of the legs.

const user = db.users.findOne(FILTER);
if (!user) {
  print("No user found for " + JSON.stringify(FILTER));
  quit(1);
}
const userId = user._id;

const place = (label, lat, lng) => ({ label, lat, lng, placeId: null });
const HOME = place("Home, Surrey", 49.1913, -122.849);
const SURREY_CENTRAL = place("Surrey Central Station", 49.1894, -122.8476);
const UBC = place("UBC", 49.2606, -123.246);
const WORK = place("Downtown Vancouver", 49.2827, -123.1207);
const WATERFRONT = place("Waterfront Station", 49.2859, -123.1117);

// Non-empty placeholder (Google's documented example polyline).
const POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

const driveLeg = (from, to, durationSeconds, distanceMeters, costCents) => ({
  mode: "DRIVE", from, to, durationSeconds, distanceMeters, costCents,
  polyline: POLYLINE, transitLines: [],
});
const transitLeg = (from, to, durationSeconds, distanceMeters, costCents, lines) => ({
  mode: "TRANSIT", from, to, durationSeconds, distanceMeters, costCents,
  polyline: POLYLINE, transitLines: lines,
});

const BLINE = [{ name: "99 B-Line", vehicle: "Bus" }];
const SKYTRAIN = [{ name: "Expo Line", vehicle: "SkyTrain" }];

// daysAgo, origin, midpoint (null = direct trip), destination, legs
const templates = [
  [1,  HOME, SURREY_CENTRAL, UBC,
    [driveLeg(HOME, SURREY_CENTRAL, 660, 4200, 64), transitLeg(SURREY_CENTRAL, UBC, 3300, 31000, 335, BLINE)]],
  [3,  HOME, SURREY_CENTRAL, WORK,
    [driveLeg(HOME, SURREY_CENTRAL, 600, 4200, 64), transitLeg(SURREY_CENTRAL, WATERFRONT, 2400, 27000, 335, SKYTRAIN)]],
  [5,  HOME, SURREY_CENTRAL, UBC,
    [driveLeg(HOME, SURREY_CENTRAL, 780, 4300, 66), transitLeg(SURREY_CENTRAL, UBC, 3600, 31000, 335, BLINE)]],
  [8,  HOME, null, WORK,
    [driveLeg(HOME, WORK, 2700, 32000, 486)]],
  [12, HOME, SURREY_CENTRAL, WORK,
    [driveLeg(HOME, SURREY_CENTRAL, 540, 4100, 62), transitLeg(SURREY_CENTRAL, WATERFRONT, 2520, 27000, 335, SKYTRAIN)]],
  [18, HOME, SURREY_CENTRAL, UBC,
    [driveLeg(HOME, SURREY_CENTRAL, 720, 4200, 64), transitLeg(SURREY_CENTRAL, UBC, 3420, 31000, 335, BLINE)]],
  [25, SURREY_CENTRAL, null, WORK,
    [transitLeg(SURREY_CENTRAL, WATERFRONT, 2400, 27000, 335, SKYTRAIN)]],
  [33, HOME, SURREY_CENTRAL, UBC,
    [driveLeg(HOME, SURREY_CENTRAL, 630, 4200, 64), transitLeg(SURREY_CENTRAL, UBC, 3180, 31000, 335, BLINE)]],
  [45, HOME, SURREY_CENTRAL, WORK,
    [driveLeg(HOME, SURREY_CENTRAL, 690, 4300, 66), transitLeg(SURREY_CENTRAL, WATERFRONT, 2580, 27000, 335, SKYTRAIN)]],
  [58, HOME, null, UBC,
    [driveLeg(HOME, UBC, 3000, 45000, 684)]],
];

const now = new Date();
const trips = templates.map(([daysAgo, origin, midpoint, destination, legs]) => {
  const tripDate = new Date(now.getTime() - daysAgo * 86400000);
  tripDate.setHours(8, 15, 0, 0); // morning commute
  return {
    userId,
    origin,
    midpoint,
    destination,
    legs,
    totalDurationSeconds: legs.reduce((s, l) => s + l.durationSeconds, 0),
    totalCostCents: legs.reduce((s, l) => s + l.costCents, 0),
    tripDate,
    seeded: true,
    createdAt: now,
    updatedAt: now,
  };
});

// Re-runnable: replace this user's previously seeded trips only.
const removed = db.trips.deleteMany({ userId, seeded: true }).deletedCount;
const inserted = Object.keys(db.trips.insertMany(trips).insertedIds).length;
print("User: " + user.email + " (" + userId + ")");
print("Removed " + removed + " old seeded trips, inserted " + inserted + ".");