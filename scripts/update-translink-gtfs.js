// Refreshes the TransLink static GTFS data that LiveUpdates matches trips against (#87):
//   backend/src/data/translink-routes.json   each route's IDs and names, the stops it serves in each direction, in order,
//                                            and its trip IDs as ranges (most real-time runs give only a trip_id)
//   backend/src/data/translink-stops.json    each stop a route serves: name, location and parent station
//
// Google gives a trip's line names and stop names and locations, but TransLink's real-time feeds use its own route
// and stop IDs, so the backend maps one to the other with these files. Run it when TransLink publishes a new
// schedule (feed_info.txt's feed_end_date is in translink-routes.json), then commit both files:
//
//   node scripts/update-translink-gtfs.js                  downloads TransLink's current GTFS
//   node scripts/update-translink-gtfs.js path/to/gtfs.zip uses a zip you already have
//
// Plain Node 22 (built-in fetch and zlib), no npm packages and no system unzip, so it runs the same on Windows.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const GTFS_URL = 'https://gtfs-static.translink.ca/gtfs/google_transit.zip'; // public, no API key needed
const DATA_DIR = path.join(__dirname, '..', 'backend', 'src', 'data');
const ROUTES_FILE = path.join(DATA_DIR, 'translink-routes.json');
const STOPS_FILE = path.join(DATA_DIR, 'translink-stops.json');
// a sanity check before overwriting: TransLink has about 240 routes and 8,800 stops
const MIN_ROUTES = 100;
const MIN_STOPS = 1000;

// ---- zip: just enough to read deflated or stored files from a normal (non-zip64) archive ----

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** Returns every file in a zip as a map from name to its compressed entry. */
function readZipEntries(zip) {
  // the end record is in the last 22 bytes plus a comment of up to 64 KiB
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i -= 1) {
    if (zip.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file (no end of central directory)');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error('zip64 archives are not supported');

  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw new Error('Corrupt zip central directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Returns one file of a zip as text. */
function readZipText(zip, entries, name) {
  const entry = entries.get(name);
  if (entry === undefined) throw new Error(`The GTFS zip has no ${name}`);
  const local = entry.localOffset;
  if (zip.readUInt32LE(local) !== LOCAL_FILE_HEADER) throw new Error(`Corrupt zip entry ${name}`);
  // the local header's own name and extra lengths, which can differ from the central directory's
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + entry.compressedSize);
  if (entry.method === STORED) return data.toString('utf8');
  if (entry.method === DEFLATED) return zlib.inflateRawSync(data).toString('utf8');
  throw new Error(`${name} uses zip compression method ${entry.method}, which this script can't read`);
}

// ---- CSV ----

/** Splits one CSV line into fields, allowing quoted fields with commas and doubled quotes. */
function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Calls onRow with each row of a GTFS file as { column: value }, for only the columns asked for. Walks the text
 * with indexOf instead of splitting it, since stop_times.txt is about 90 MB.
 */
function eachRow(text, columns, onRow) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // byte order mark
  let lineEnd = body.indexOf('\n');
  const header = splitCsvLine(body.slice(0, lineEnd).replace(/\r$/, '')).map((name) => name.trim());
  const indexes = columns.map((column) => {
    const index = header.indexOf(column);
    if (index < 0) throw new Error(`Missing column ${column}`);
    return index;
  });
  let start = lineEnd + 1;
  while (start < body.length) {
    lineEnd = body.indexOf('\n', start);
    if (lineEnd < 0) lineEnd = body.length;
    const line = body.slice(start, lineEnd).replace(/\r$/, '');
    start = lineEnd + 1;
    if (line === '') continue;
    const fields = splitCsvLine(line);
    const row = {};
    columns.forEach((column, i) => {
      row[column] = (fields[indexes[i]] ?? '').trim();
    });
    onRow(row);
  }
}

// ---- GTFS → our two files ----

function readFeedVersion(zip, entries) {
  let feed = null;
  eachRow(readZipText(zip, entries, 'feed_info.txt'), ['feed_version', 'feed_start_date', 'feed_end_date'], (row) => {
    feed ??= { version: row.feed_version, startDate: row.feed_start_date, endDate: row.feed_end_date };
  });
  if (feed === null) throw new Error('feed_info.txt is empty');
  return feed;
}

/**
 * Merges a route direction's stop patterns (its trips' stops in order) into one list in travel order, so a stop
 * that comes before another on any trip comes before it here. The longest pattern is the base, and each other
 * pattern's new stops (a branch, a short-turn, a detour) go in just after the stop before them.
 */
function mergePatterns(patterns) {
  const [base, ...rest] = [...patterns].sort((a, b) => b.length - a.length);
  const merged = [...base];
  for (const pattern of rest) {
    let insertAt = 0; // stops before the first shared one go at the start
    for (const stopId of pattern) {
      const index = merged.indexOf(stopId);
      if (index >= 0) {
        insertAt = index + 1;
      } else {
        merged.splice(insertAt, 0, stopId);
        insertAt += 1;
      }
    }
  }
  return merged;
}

/**
 * Turns a route's trip IDs into sorted [first, last] ranges of consecutive IDs. TransLink numbers a route's trips in
 * blocks, so about 63,000 trips become under 1,000 ranges. A trip ID that isn't a number would need a different
 * format, so it stops the script rather than being dropped.
 */
function toRanges(tripIds) {
  const numbers = tripIds.map((id) => {
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error(`Trip ID ${id} is not a whole number`);
    return Number(id);
  }).sort((a, b) => a - b);
  const ranges = [];
  for (const id of numbers) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && id <= last[1] + 1) last[1] = Math.max(last[1], id);
    else ranges.push([id, id]);
  }
  return ranges;
}

// the stops each route serves in each direction (GTFS direction_id 0 and 1), in travel order, and its trip IDs
function readRouteStops(zip, entries) {
  const tripRoute = new Map(); // trip_id → { routeId, direction }
  eachRow(readZipText(zip, entries, 'trips.txt'), ['trip_id', 'route_id', 'direction_id'], (row) => {
    tripRoute.set(row.trip_id, { routeId: row.route_id, direction: row.direction_id === '1' ? 1 : 0 });
  });
  const routeTrips = new Map(); // route_id → trip_ids
  for (const [tripId, { routeId }] of tripRoute) {
    if (!routeTrips.has(routeId)) routeTrips.set(routeId, []);
    routeTrips.get(routeId).push(tripId);
  }
  const tripStops = new Map(); // trip_id → [[stop_sequence, stop_id]]
  eachRow(readZipText(zip, entries, 'stop_times.txt'), ['trip_id', 'stop_id', 'stop_sequence'], (row) => {
    if (!tripStops.has(row.trip_id)) tripStops.set(row.trip_id, []);
    tripStops.get(row.trip_id).push([Number(row.stop_sequence), row.stop_id]);
  });
  const patterns = new Map(); // route_id → [Map of pattern key → stop_ids, for direction 0, for direction 1]
  for (const [tripId, stops] of tripStops) {
    const trip = tripRoute.get(tripId);
    if (trip === undefined) continue;
    const stopIds = [...new Set(stops.sort((a, b) => a[0] - b[0]).map(([, stopId]) => stopId))]; // a loop's repeat once
    if (!patterns.has(trip.routeId)) patterns.set(trip.routeId, [new Map(), new Map()]);
    patterns.get(trip.routeId)[trip.direction].set(stopIds.join(','), stopIds);
  }
  const routeStops = new Map(); // route_id → [stop_ids in order for direction 0, for direction 1]
  for (const [routeId, directions] of patterns) {
    routeStops.set(routeId, directions.map((byKey) => byKey.size === 0 ? [] : mergePatterns([...byKey.values()])));
  }
  return { routeStops, routeTrips };
}

function readRoutes(zip, entries, { routeStops, routeTrips }) {
  const routes = [];
  const columns = ['route_id', 'route_short_name', 'route_long_name', 'route_type'];
  eachRow(readZipText(zip, entries, 'routes.txt'), columns, (row) => {
    const [direction0, direction1] = routeStops.get(row.route_id) ?? [[], []];
    if (direction0.length === 0 && direction1.length === 0) return; // no trips in this schedule
    routes.push({
      id: row.route_id,
      shortName: row.route_short_name, // as TransLink writes it, e.g. "033", "R4", or '' for SkyTrain lines
      longName: row.route_long_name,
      type: Number(row.route_type), // GTFS route_type: 1 SkyTrain, 2 West Coast Express, 3 bus, 4 SeaBus
      stopsByDirection: [direction0, direction1], // in travel order, so the matcher can tell the two directions apart
      tripIdRanges: toRanges(routeTrips.get(row.route_id) ?? []), // [first, last] trip_ids, for runs with no route_id
    });
  });
  return routes.sort((a, b) => byId(a.id, b.id));
}

function readStops(zip, entries, servedStopIds) {
  const stops = [];
  const columns = ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'parent_station'];
  eachRow(readZipText(zip, entries, 'stops.txt'), columns, (row) => {
    if (!servedStopIds.has(row.stop_id)) return; // stations, entrances and unused stops
    stops.push({
      id: row.stop_id,
      name: row.stop_name,
      lat: Number(row.stop_lat),
      lng: Number(row.stop_lon),
      parentId: row.parent_station === '' ? null : row.parent_station, // the station a platform belongs to
    });
  });
  return stops.sort((a, b) => byId(a.id, b.id));
}

// numeric IDs in numeric order, so a refresh's diff lines up
function byId(a, b) {
  return a.localeCompare(b, 'en', { numeric: true });
}

// one route or stop per line, so a refresh shows up as a readable diff
function writeJsonList(file, header, key, items) {
  const lines = items.map((item) => `    ${JSON.stringify(item)}`);
  const head = JSON.stringify(header, null, 2).replace(/\n}$/, '');
  fs.writeFileSync(file, `${head},\n  "${key}": [\n${lines.join(',\n')}\n  ]\n}\n`);
}

async function loadZip(source) {
  if (source !== undefined) return fs.readFileSync(source);
  console.log(`Downloading ${GTFS_URL}`);
  const response = await fetch(GTFS_URL);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const zip = await loadZip(process.argv[2]);
  const entries = readZipEntries(zip);
  const feed = readFeedVersion(zip, entries);
  const routes = readRoutes(zip, entries, readRouteStops(zip, entries));
  const served = new Set(routes.flatMap((route) => route.stopsByDirection.flat()));
  const stops = readStops(zip, entries, served);

  const stopIds = new Set(stops.map((stop) => stop.id));
  const missing = [...served].filter((id) => !stopIds.has(id));
  if (routes.length < MIN_ROUTES || stops.length < MIN_STOPS || missing.length > 0) {
    throw new Error(`Unexpected GTFS: ${routes.length} routes, ${stops.length} stops, ${missing.length} stops missing`);
  }
  const header = { source: GTFS_URL, feedVersion: feed.version, feedStartDate: feed.startDate, feedEndDate: feed.endDate };
  writeJsonList(ROUTES_FILE, header, 'routes', routes);
  writeJsonList(STOPS_FILE, header, 'stops', stops);
  console.log(`Wrote ${routes.length} routes and ${stops.length} stops from feed ${feed.version} (valid to ${feed.endDate})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
