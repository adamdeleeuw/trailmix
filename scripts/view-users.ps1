<#
.SYNOPSIS
  Lists every user in the dockerised MongoDB with their Google ID, plus trip counts.

.EXAMPLE
  .\scripts\view-users.ps1
  .\scripts\view-users.ps1 -Json     # raw documents
#>
[CmdletBinding()]
param(
  [switch]$Json,
  [string]$Container = "cpen321-project-mongo-1",
  [string]$Database  = "trailmix"
)

$ErrorActionPreference = "Stop"

$opts = @{ json = [bool]$Json } | ConvertTo-Json -Compress

$js = "const OPTS = $opts;`n" + @'
const users = db.users.find().sort({ createdAt: 1 }).toArray();
print("Users: " + users.length);

if (OPTS.json) {
  printjson(users);
} else {
  // userId -> { total, seeded } trip counts
  const counts = {};
  db.trips.aggregate([
    { $group: { _id: "$userId", total: { $sum: 1 }, seeded: { $sum: { $cond: ["$seeded", 1, 0] } } } },
  ]).forEach(r => { counts[r._id.toString()] = r; });

  const iso = d => (d instanceof Date ? d.toISOString().slice(0, 16).replace("T", " ") : "-");

  console.table(users.map(u => {
    const c = counts[u._id.toString()] || { total: 0, seeded: 0 };
    return {
      googleId: u.googleId,
      email: u.email,
      name: u.name,
      userId: u._id.toString(),
      profile: u.profileComplete ? "complete" : "incomplete",
      trips: c.total,
      seeded: c.seeded,
      created: iso(u.createdAt),
    };
  }));

  // Trips whose userId matches no user
  const known = new Set(users.map(u => u._id.toString()));
  const orphans = Object.keys(counts).filter(id => !known.has(id));
  if (orphans.length) {
    print("\nWarning: trips exist for userIds with no matching user:");
    orphans.forEach(id => print("  " + id + " (" + counts[id].total + " trips)"));
  }
}
'@

$js | docker exec -i $Container mongosh "mongodb://localhost:27017/$Database" --quiet
if ($LASTEXITCODE -ne 0) { throw "mongosh exited with code $LASTEXITCODE" }
