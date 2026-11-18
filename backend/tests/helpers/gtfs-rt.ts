/**
 * Builds GTFS Realtime feeds as protobuf bytes, for tests of the decoder and LiveUpdates.
 *
 * @remarks
 * A test-only encoder with the same field numbers as `src/services/gtfs-rt-decoder.ts` (from the official
 * `gtfs-realtime.proto`). Tests that need TransLink's real feeds use the saved ones in `tests/fixtures/translink/`.
 */

const VARINT = 0;
const FIXED64 = 1;
const LENGTH_DELIMITED = 2;
const FIXED32 = 5;

/** A varint, with negative numbers as 64-bit two's complement (10 bytes), as protobuf writes int32 and int64. */
function varint(value: number | bigint): number[] {
  let rest = BigInt.asUintN(64, BigInt(value));
  const bytes: number[] = [];
  do {
    const low = Number(rest & 0x7fn);
    rest >>= 7n;
    bytes.push(rest === 0n ? low : low | 0x80);
  } while (rest !== 0n);
  return bytes;
}

const tag = (field: number, wireType: number) => varint((field << 3) | wireType);

/** Encodes protobuf fields; each method returns one field's bytes. */
export const pb = {
  int: (field: number, value: number | bigint): number[] => [...tag(field, VARINT), ...varint(value)],
  bytes: (field: number, bytes: readonly number[]): number[] => [...tag(field, LENGTH_DELIMITED), ...varint(bytes.length), ...bytes],
  string: (field: number, text: string): number[] => pb.bytes(field, [...Buffer.from(text, 'utf8')]),
  message: (field: number, ...fields: number[][]): number[] => pb.bytes(field, fields.flat()),
  fixed32: (field: number): number[] => [...tag(field, FIXED32), 1, 2, 3, 4],
  fixed64: (field: number): number[] => [...tag(field, FIXED64), 1, 2, 3, 4, 5, 6, 7, 8],
};

/** A predicted arrival or departure: seconds since the epoch, and seconds late. */
export interface EventSpec { time?: number; delay?: number }

/** One stop of a run. */
export interface StopSpec { stopId: string; arrival?: EventSpec; departure?: EventSpec; skipped?: boolean }

/** A run of a route, with its stops' predictions. */
export interface TripUpdateSpec {
  id: string;
  routeId?: string; // left out like most of TransLink's runs, which give only a trip_id
  tripId?: string;
  directionId?: number;
  cancelled?: boolean;
  delay?: number;
  stops: StopSpec[];
}

/** What an alert applies to. */
export interface SelectorSpec { routeId?: string; routeType?: number; stopId?: string; directionId?: number }

/** A service alert. Text without a language is sent as English. */
export interface AlertSpec {
  id: string;
  periods?: { start?: number; end?: number }[];
  selectors: SelectorSpec[];
  effect?: number;
  header?: string;
  description?: string;
  deleted?: boolean;
}

const optional = <T>(value: T | undefined, encode: (value: T) => number[]): number[] =>
  value === undefined ? [] : encode(value);

function stopTimeEvent(field: number, event: EventSpec | undefined): number[] {
  if (event === undefined) return [];
  return pb.message(field, optional(event.delay, (d) => pb.int(1, d)), optional(event.time, (t) => pb.int(2, t)));
}

function translated(field: number, text: string | undefined): number[] {
  return optional(text, (t) => pb.message(field, pb.message(1, pb.string(1, t), pb.string(2, 'en'))));
}

/** A FeedEntity with a TripUpdate. */
export function tripUpdateEntity(spec: TripUpdateSpec): number[] {
  const trip = pb.message(1,
    optional(spec.tripId, (id) => pb.string(1, id)),
    spec.cancelled === true ? pb.int(4, 3) : [],
    optional(spec.routeId, (id) => pb.string(5, id)),
    optional(spec.directionId, (d) => pb.int(6, d)));
  const stops = spec.stops.map((stop) => pb.message(2,
    stopTimeEvent(2, stop.arrival),
    stopTimeEvent(3, stop.departure),
    pb.string(4, stop.stopId),
    stop.skipped === true ? pb.int(5, 1) : []));
  return pb.message(2, pb.string(1, spec.id), pb.message(3, trip, ...stops, optional(spec.delay, (d) => pb.int(5, d))));
}

/** A FeedEntity with an Alert. */
export function alertEntity(spec: AlertSpec): number[] {
  const periods = (spec.periods ?? []).map((period) =>
    pb.message(1, optional(period.start, (s) => pb.int(1, s)), optional(period.end, (e) => pb.int(2, e))));
  const selectors = spec.selectors.map((selector) => pb.message(5,
    optional(selector.routeId, (id) => pb.string(2, id)),
    optional(selector.routeType, (type) => pb.int(3, type)),
    optional(selector.stopId, (id) => pb.string(5, id)),
    optional(selector.directionId, (d) => pb.int(6, d))));
  const alert = pb.message(5, ...periods, ...selectors,
    optional(spec.effect, (e) => pb.int(7, e)), translated(10, spec.header), translated(11, spec.description));
  return pb.message(2, pb.string(1, spec.id), spec.deleted === true ? pb.int(2, 1) : [], alert);
}

/** A whole FeedMessage, with a header made at `timestamp`. */
export function feedBytes(timestamp: number, entities: number[][]): Uint8Array {
  const header = pb.message(1, pb.string(1, '2.0'), pb.int(3, timestamp));
  return Uint8Array.from([...header, ...entities.flat()]);
}
