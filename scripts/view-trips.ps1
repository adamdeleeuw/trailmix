<#
.SYNOPSIS
  Prints trips from the dockerised MongoDB as a table, with the owning user.

.EXAMPLE
  .\scripts\view-trips.ps1                          # all users' trips, newest first
  .\scripts\view-trips.ps1 -Email "you@gmail.com"   # one user's trips
  .\scripts\view-trips.ps1 -GoogleId "104829..."
  .\scripts\view-trips.ps1 -SeededOnly              # only demo trips
  .\scripts\view-trips.ps1 -Limit 5 -Json           # raw documents for the first 5
#>
[CmdletBinding()]
param(
  [string]$GoogleId,
  [string]$Email,
  [switch]$SeededOnly,
  [int]$Limit = 50,
  [switch]$Json,
  [string]$Container = "cpen321-project-mongo-1",
  [string]$Database  = "trailmix"
)

$ErrorActionPreference = "Stop"

$opts = @{
  googleId   = $GoogleId
  email      = $Email
  seededOnly = [bool]$SeededOnly
  limit      = $Limit
  json       = [bool]$Json
} | ConvertTo-Json -Compress

$js = "const OPTS = $opts;`n" + @'
// Resolve an optional user filter
const query = {};
if (OPTS.googleId || OPTS.email) {
  const u = db.users.findOne(OPTS.googleId ? { googleId: OPTS.googleId } : { email: OPTS.email });
  if (!u) { print("No user found for that filter."); quit(1); }
  query.userId = u._id;
}
if (OPTS.seededOnly) query.seeded = true;

// Map userId -> email so each row shows who owns the trip
const emailById = {};
db.users.find({}, { email: 1 }).forEach(u => { emailById[u._id.toString()] = u.email; });

const trips = db.trips.find(query).sort({ tripDate: -1 }).limit(OPTS.limit).toArray();
print("Showing " + trips.length + " of " + db.trips.countDocuments(query) + " trips (newest first)");

if (OPTS.json) {
  printjson(trips);
} else {
  console.table(trips.map(t => ({
    date: t.tripDate instanceof Date ? t.tripDate.toISOString().slice(0, 16).replace("T", " ") : String(t.tripDate),
    user: emailById[t.userId.toString()] || "(unknown user)",
    userId: t.userId.toString(),
    from: t.origin.label,
    via: t.midpoint ? t.midpoint.label : "-",
    to: t.destination.label,
    legs: t.legs.map(l => l.mode === "DRIVE" ? "D" : "T").join("+"),
    mins: Math.round(t.totalDurationSeconds / 60),
    cost: "$" + (t.totalCostCents / 100).toFixed(2),
    seeded: !!t.seeded,
  })));

  // Per-user summary
  print("\nTrips per user:");
  console.table(db.trips.aggregate([
    { $match: query },
    { $group: { _id: "$userId", trips: { $sum: 1 }, totalSeconds: { $sum: "$totalDurationSeconds" }, totalCents: { $sum: "$totalCostCents" } } },
    { $sort: { trips: -1 } },
  ]).toArray().map(r => ({
    userId: r._id.toString(),
    user: emailById[r._id.toString()] || "(unknown user)",
    trips: r.trips,
    hours: (r.totalSeconds / 3600).toFixed(1),
    cost: "$" + (r.totalCents / 100).toFixed(2),
  })));
}
'@

$js | docker exec -i $Container mongosh "mongodb://localhost:27017/$Database" --quiet
if ($LASTEXITCODE -ne 0) { throw "mongosh exited with code $LASTEXITCODE" }
