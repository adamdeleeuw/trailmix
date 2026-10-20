<#
.SYNOPSIS
  Seeds 10 demo trips for one user in the dockerised MongoDB.

.EXAMPLE
  .\scripts\seed-trips.ps1 -Email "you@gmail.com"
  .\scripts\seed-trips.ps1 -GoogleId "109042179693245092144"
  .\scripts\seed-trips.ps1 -Email "you@gmail.com" -Clear   # only delete seeded trips
#>
[CmdletBinding()]
param(
  [string]$GoogleId,
  [string]$Email,
  [string]$Container = "cpen321-project-mongo-1",
  [string]$Database  = "trailmix",
  [string]$ScriptPath = (Join-Path $PSScriptRoot "seed-trips.js"),
  [switch]$Clear
)

$ErrorActionPreference = "Stop"

if (-not $GoogleId -and -not $Email) {
  throw "Provide -GoogleId or -Email."
}
if (-not (Test-Path $ScriptPath)) {
  throw "Cannot find $ScriptPath"
}

# Build the FILTER line (single quotes escaped for JS).
if ($GoogleId) { $filter = "{ googleId: '" + $GoogleId.Replace("'", "\'") + "' }" }
else           { $filter = "{ email: '" + $Email.Replace("'", "\'") + "' }" }

if ($Clear) {
  $js = "const FILTER = $filter;`n" + @'
const u = db.users.findOne(FILTER);
if (!u) { print("No user found"); quit(1); }
print("Deleted " + db.trips.deleteMany({ userId: u._id, seeded: true }).deletedCount + " seeded trips.");
'@
} else {
  $js = "const FILTER = $filter;`n" + (Get-Content $ScriptPath -Raw)
}

Write-Host "==> Running against $Container / $Database ..."
$js | docker exec -i $Container mongosh "mongodb://localhost:27017/$Database" --quiet
if ($LASTEXITCODE -ne 0) { throw "mongosh exited with code $LASTEXITCODE" }

Write-Host "==> Done. Seeded trips now stored: " -NoNewline
docker exec $Container mongosh "mongodb://localhost:27017/$Database" --quiet --eval "db.trips.countDocuments({ seeded: true })"
