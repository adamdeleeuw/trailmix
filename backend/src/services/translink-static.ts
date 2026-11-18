import routesFile from '../data/translink-routes.json';
import stopsFile from '../data/translink-stops.json';

/** A TransLink route from its static GTFS, with the stops it serves in each direction. */
export interface TranslinkRoute {
  id: string; // GTFS route_id, which the real-time feeds use
  shortName: string; // as TransLink writes it: "002", "R4", "WCE", or '' for SkyTrain lines and SeaBus
  longName: string; // e.g. "Broadway B-Line", "Expo Line"
  type: number; // GTFS route_type: 1 SkyTrain, 2 West Coast Express, 3 bus, 4 SeaBus
  stopsByDirection: [string[], string[]]; // stop_ids served in GTFS direction_id 0 and 1, in travel order
  tripIdRanges: [number, number][]; // [first, last] of each block of consecutive trip_ids, sorted
}

/** A stop or platform some TransLink route serves. */
export interface TranslinkStop {
  id: string; // GTFS stop_id
  name: string; // e.g. "UBC Exchange @ Bay 7", "Waterfront Station @ Platform 1"
  lat: number;
  lng: number;
  parentId: string | null; // the station a platform belongs to, which an alert may name instead
}

/** TransLink's routes and stops, and lookups by ID. */
export interface TranslinkStatic {
  feedVersion: string;
  routes: readonly TranslinkRoute[];
  stopsById: ReadonlyMap<string, TranslinkStop>;
  tripRanges: readonly TripRange[]; // every route's trip_id ranges, sorted by first, for routeIdForTrip
}

/** A block of consecutive trip_ids that all belong to one route. */
interface TripRange {
  first: number;
  last: number;
  routeId: string;
}

/**
 * Indexes TransLink's routes and stops.
 *
 * @remarks
 * The data is `scripts/update-translink-gtfs.js`'s trimmed copy of TransLink's static GTFS, in `src/data/`. It's
 * taken as arguments so tests can build a small network of their own.
 */
export function buildTranslinkStatic(
  feedVersion: string,
  routes: readonly TranslinkRoute[],
  stops: readonly TranslinkStop[],
): TranslinkStatic {
  const tripRanges = routes
    .flatMap((route) => route.tripIdRanges.map(([first, last]) => ({ first, last, routeId: route.id })))
    .sort((a, b) => a.first - b.first);
  return { feedVersion, routes, stopsById: new Map(stops.map((stop) => [stop.id, stop])), tripRanges };
}

/**
 * Finds the route a run belongs to from its trip_id.
 *
 * @remarks
 * TransLink's trip updates feed gives most runs only a trip_id, so the route comes from the static schedule. A
 * binary search over the sorted ranges, since the poller asks this for every run in every feed.
 *
 * @param network - TransLink's routes, with their trip_id ranges.
 * @param tripId - The run's trip_id, from the real-time feed.
 * @returns The route's ID, or null for a trip_id the schedule doesn't have (e.g. an added run, or a new schedule).
 */
export function routeIdForTrip(network: TranslinkStatic, tripId: string | null): string | null {
  if (tripId === null || !/^\d+$/.test(tripId)) return null;
  const id = Number(tripId);
  let low = 0;
  let high = network.tripRanges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = network.tripRanges[middle];
    if (range === undefined) return null;
    if (id < range.first) high = middle - 1;
    else if (id > range.last) low = middle + 1;
    else return range.routeId;
  }
  return null;
}

let loaded: TranslinkStatic | null = null;

/** TransLink's network from the committed GTFS files, indexed the first time it's asked for. */
export function translinkStatic(): TranslinkStatic {
  loaded ??= buildTranslinkStatic(
    routesFile.feedVersion,
    routesFile.routes as TranslinkRoute[], // the script writes exactly two directions per route
    stopsFile.stops,
  );
  return loaded;
}
