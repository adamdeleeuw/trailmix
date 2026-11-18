/**
 * A minimal decoder for the GTFS Realtime protobuf feeds TransLink publishes (#87).
 *
 * @remarks
 * No protobuf library is on the course's approved list, so this reads the protobuf wire format itself, and only
 * the messages and fields LiveUpdates uses. Every other field is skipped by its wire type, so new or extension
 * fields in TransLink's feed don't break it. Field numbers are from the official `gtfs-realtime.proto`
 * (https://gtfs.org/documentation/realtime/proto/), noted beside each one below.
 *
 * Call {@link decodeFeed}; everything else here is its helpers.
 */

/** When a predicted arrival or departure is, and how late it is. */
export interface StopTimeEvent {
  delay: number | null; // seconds late, negative when early (StopTimeEvent.delay = 1)
  time: number | null; // predicted time, in seconds since the epoch (StopTimeEvent.time = 2)
}

/** One stop on a run, with its predicted times. */
export interface StopTimeUpdate {
  stopId: string | null; // StopTimeUpdate.stop_id = 4
  arrival: StopTimeEvent | null; // StopTimeUpdate.arrival = 2
  departure: StopTimeEvent | null; // StopTimeUpdate.departure = 3
  skipped: boolean; // StopTimeUpdate.schedule_relationship = 5 is SKIPPED (1)
}

/** The predictions for one run of a route. */
export interface TripUpdate {
  tripId: string | null; // TripDescriptor.trip_id = 1
  routeId: string | null; // TripDescriptor.route_id = 5
  directionId: number | null; // TripDescriptor.direction_id = 6
  cancelled: boolean; // TripDescriptor.schedule_relationship = 4 is CANCELED (3)
  delay: number | null; // the whole run's delay, when no stop gives one (TripUpdate.delay = 5)
  stopTimeUpdates: StopTimeUpdate[]; // TripUpdate.stop_time_update = 2
}

/** What an alert applies to. Every field given must match (they are ANDed). */
export interface InformedEntity {
  routeId: string | null; // EntitySelector.route_id = 2
  routeType: number | null; // EntitySelector.route_type = 3
  stopId: string | null; // EntitySelector.stop_id = 5
  directionId: number | null; // EntitySelector.direction_id = 6
}

/** A period an alert is in effect. A missing end means until further notice. */
export interface ActivePeriod {
  start: number | null; // seconds since the epoch (TimeRange.start = 1)
  end: number | null; // TimeRange.end = 2
}

/** GTFS-RT's Alert.Effect names, by value. */
const EFFECTS: Record<number, string> = {
  1: 'NO_SERVICE',
  2: 'REDUCED_SERVICE',
  3: 'SIGNIFICANT_DELAYS',
  4: 'DETOUR',
  5: 'ADDITIONAL_SERVICE',
  6: 'MODIFIED_SERVICE',
  7: 'OTHER_EFFECT',
  8: 'UNKNOWN_EFFECT',
  9: 'STOP_MOVED',
  10: 'NO_EFFECT',
  11: 'ACCESSIBILITY_ISSUE',
};
const DEFAULT_EFFECT = 'UNKNOWN_EFFECT'; // the .proto's default when the field is left out

/** A service alert, like a detour or a SkyTrain delay. */
export interface Alert {
  activePeriods: ActivePeriod[]; // Alert.active_period = 1; none means always
  informedEntities: InformedEntity[]; // Alert.informed_entity = 5
  effect: string; // Alert.effect = 7, by name, e.g. "DETOUR"
  header: string | null; // Alert.header_text = 10, the English translation when there is one
  description: string | null; // Alert.description_text = 11
}

/** One entity of a feed. A feed of trip updates has trip updates, a feed of alerts has alerts. */
export interface FeedEntity {
  id: string; // FeedEntity.id = 1
  deleted: boolean; // FeedEntity.is_deleted = 2
  tripUpdate: TripUpdate | null; // FeedEntity.trip_update = 3
  alert: Alert | null; // FeedEntity.alert = 5
}

/** A decoded feed. */
export interface Feed {
  timestamp: number | null; // when TransLink made the feed, in seconds since the epoch (FeedHeader.timestamp = 3)
  entities: FeedEntity[]; // FeedMessage.entity = 2
}

// ---- the protobuf wire format ----

const VARINT = 0;
const FIXED64 = 1;
const LENGTH_DELIMITED = 2;
const FIXED32 = 5;
const MAX_VARINT_BYTES = 10;
const SAFE_VARINT_BYTES = 7; // 49 bits, exact as a double; longer varints (big or negative) go through BigInt

/** Thrown when a buffer isn't a valid protobuf message. */
export class FeedDecodeError extends Error {}

/** Reads protobuf fields from one message's bytes. */
class Reader {
  private position: number;

  constructor(private readonly bytes: Uint8Array, start = 0, private readonly end = bytes.length) {
    this.position = start;
  }

  get done(): boolean {
    return this.position >= this.end;
  }

  /** Reads a field's tag, as its number and wire type. */
  tag(): { field: number; wireType: number } {
    const tag = this.varint();
    const field = Number(tag >> 3n);
    if (field === 0) throw new FeedDecodeError('Field number 0');
    return { field, wireType: Number(tag & 7n) };
  }

  /** Reads a varint as a BigInt, since an int64 or a negative int32 takes 10 bytes. */
  varint(): bigint {
    let small = 0;
    let result = 0n;
    for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
      if (this.position >= this.end) throw new FeedDecodeError('Truncated varint');
      const byte = this.bytes[this.position] ?? 0;
      this.position += 1;
      if (index < SAFE_VARINT_BYTES) {
        small += (byte & 0x7f) * 2 ** (7 * index);
      } else {
        result = (index === SAFE_VARINT_BYTES ? BigInt(small) : result) + (BigInt(byte & 0x7f) << BigInt(7 * index));
      }
      if ((byte & 0x80) === 0) return index < SAFE_VARINT_BYTES ? BigInt(small) : result;
    }
    throw new FeedDecodeError('Varint longer than 10 bytes');
  }

  /** Reads a varint as a signed 64-bit number (int32, int64 and enums), which fits a double for our values. */
  int(): number {
    return Number(BigInt.asIntN(64, this.varint()));
  }

  /** Reads a varint as an unsigned number (uint32, uint64). */
  uint(): number {
    return Number(BigInt.asUintN(64, this.varint()));
  }

  /** Reads a length-delimited field and returns a Reader over just its bytes. */
  message(): Reader {
    const length = this.uint();
    const start = this.position;
    if (length > this.end - start) throw new FeedDecodeError('Length past the end of the message');
    this.position = start + length;
    return new Reader(this.bytes, start, start + length);
  }

  string(): string {
    const inner = this.message();
    return Buffer.from(inner.bytes.buffer, inner.bytes.byteOffset + inner.position, inner.end - inner.position).toString('utf8');
  }

  /** Skips a field this decoder doesn't use. */
  skip(wireType: number): void {
    switch (wireType) {
      case VARINT:
        this.varint();
        return;
      case FIXED64:
        this.advance(8);
        return;
      case LENGTH_DELIMITED:
        this.message();
        return;
      case FIXED32:
        this.advance(4);
        return;
      default:
        throw new FeedDecodeError(`Unsupported wire type ${wireType}`); // 3 and 4 are groups, which GTFS-RT doesn't use
    }
  }

  private advance(count: number): void {
    if (count > this.end - this.position) throw new FeedDecodeError('Truncated fixed-width field');
    this.position += count;
  }
}

/** Reads each field of a message, calling `onField` for the ones it handles and skipping the rest. */
function eachField(reader: Reader, onField: (field: number, wireType: number) => boolean): void {
  while (!reader.done) {
    const { field, wireType } = reader.tag();
    if (!onField(field, wireType)) reader.skip(wireType);
  }
}

/** Whether a field is the length-delimited one asked for, so a field with an unexpected wire type is skipped. */
const isMessage = (wireType: number) => wireType === LENGTH_DELIMITED;
const isVarint = (wireType: number) => wireType === VARINT;

// ---- GTFS-RT messages ----

function readStopTimeEvent(reader: Reader): StopTimeEvent {
  const event: StopTimeEvent = { delay: null, time: null };
  eachField(reader, (field, wireType) => {
    if (!isVarint(wireType)) return false;
    if (field === 1) event.delay = reader.int();
    else if (field === 2) event.time = reader.int();
    else return false;
    return true;
  });
  return event;
}

function readStopTimeUpdate(reader: Reader): StopTimeUpdate {
  const update: StopTimeUpdate = { stopId: null, arrival: null, departure: null, skipped: false };
  eachField(reader, (field, wireType) => {
    if (field === 2 && isMessage(wireType)) update.arrival = readStopTimeEvent(reader.message());
    else if (field === 3 && isMessage(wireType)) update.departure = readStopTimeEvent(reader.message());
    else if (field === 4 && isMessage(wireType)) update.stopId = reader.string();
    else if (field === 5 && isVarint(wireType)) update.skipped = reader.int() === 1;
    else return false;
    return true;
  });
  return update;
}

// TripDescriptor's fields go straight onto the TripUpdate
function readTripDescriptor(reader: Reader, update: TripUpdate): void {
  eachField(reader, (field, wireType) => {
    if (field === 1 && isMessage(wireType)) update.tripId = reader.string();
    else if (field === 4 && isVarint(wireType)) update.cancelled = reader.int() === 3;
    else if (field === 5 && isMessage(wireType)) update.routeId = reader.string();
    else if (field === 6 && isVarint(wireType)) update.directionId = reader.uint();
    else return false;
    return true;
  });
}

function readTripUpdate(reader: Reader): TripUpdate {
  const update: TripUpdate = {
    tripId: null, routeId: null, directionId: null, cancelled: false, delay: null, stopTimeUpdates: [],
  };
  eachField(reader, (field, wireType) => {
    if (field === 1 && isMessage(wireType)) readTripDescriptor(reader.message(), update);
    else if (field === 2 && isMessage(wireType)) update.stopTimeUpdates.push(readStopTimeUpdate(reader.message()));
    else if (field === 5 && isVarint(wireType)) update.delay = reader.int();
    else return false;
    return true;
  });
  return update;
}

function readTimeRange(reader: Reader): ActivePeriod {
  const period: ActivePeriod = { start: null, end: null };
  eachField(reader, (field, wireType) => {
    if (!isVarint(wireType)) return false;
    if (field === 1) period.start = reader.uint();
    else if (field === 2) period.end = reader.uint();
    else return false;
    return true;
  });
  return period;
}

function readEntitySelector(reader: Reader): InformedEntity {
  const entity: InformedEntity = { routeId: null, routeType: null, stopId: null, directionId: null };
  eachField(reader, (field, wireType) => {
    if (field === 2 && isMessage(wireType)) entity.routeId = reader.string();
    else if (field === 3 && isVarint(wireType)) entity.routeType = reader.int();
    else if (field === 5 && isMessage(wireType)) entity.stopId = reader.string();
    else if (field === 6 && isVarint(wireType)) entity.directionId = reader.uint();
    else return false;
    return true;
  });
  return entity;
}

/** Reads a TranslatedString, preferring English, then a translation with no language, then the first one. */
function readTranslatedString(reader: Reader): string | null {
  const translations: { text: string; language: string | null }[] = [];
  eachField(reader, (field, wireType) => {
    if (field !== 1 || !isMessage(wireType)) return false; // TranslatedString.translation = 1
    const translation = { text: '', language: null as string | null };
    const inner = reader.message();
    eachField(inner, (innerField, innerWireType) => {
      if (!isMessage(innerWireType)) return false;
      if (innerField === 1) translation.text = inner.string(); // Translation.text = 1
      else if (innerField === 2) translation.language = inner.string(); // Translation.language = 2
      else return false;
      return true;
    });
    translations.push(translation);
    return true;
  });
  const english = translations.find((t) => t.language?.toLowerCase().startsWith('en') === true);
  return (english ?? translations.find((t) => t.language === null) ?? translations[0])?.text ?? null;
}

function readAlert(reader: Reader): Alert {
  const alert: Alert = { activePeriods: [], informedEntities: [], effect: DEFAULT_EFFECT, header: null, description: null };
  eachField(reader, (field, wireType) => {
    if (field === 1 && isMessage(wireType)) alert.activePeriods.push(readTimeRange(reader.message()));
    else if (field === 5 && isMessage(wireType)) alert.informedEntities.push(readEntitySelector(reader.message()));
    else if (field === 7 && isVarint(wireType)) alert.effect = EFFECTS[reader.int()] ?? DEFAULT_EFFECT;
    else if (field === 10 && isMessage(wireType)) alert.header = readTranslatedString(reader.message());
    else if (field === 11 && isMessage(wireType)) alert.description = readTranslatedString(reader.message());
    else return false;
    return true;
  });
  return alert;
}

function readEntity(reader: Reader): FeedEntity {
  const entity: FeedEntity = { id: '', deleted: false, tripUpdate: null, alert: null };
  eachField(reader, (field, wireType) => {
    if (field === 1 && isMessage(wireType)) entity.id = reader.string();
    else if (field === 2 && isVarint(wireType)) entity.deleted = reader.uint() !== 0;
    else if (field === 3 && isMessage(wireType)) entity.tripUpdate = readTripUpdate(reader.message());
    else if (field === 5 && isMessage(wireType)) entity.alert = readAlert(reader.message());
    else return false;
    return true;
  });
  return entity;
}

function readHeaderTimestamp(reader: Reader): number | null {
  let timestamp: number | null = null;
  eachField(reader, (field, wireType) => {
    if (field !== 3 || !isVarint(wireType)) return false; // FeedHeader.timestamp = 3
    timestamp = reader.uint();
    return true;
  });
  return timestamp;
}

/**
 * Decodes a GTFS Realtime FeedMessage: TransLink's trip updates or service alerts feed.
 *
 * @param buffer - The feed's bytes, as TransLink sent them.
 * @returns The feed's timestamp and entities, with only the fields LiveUpdates uses.
 * @throws {FeedDecodeError} If the bytes aren't a valid protobuf message, e.g. an HTML error page or a cut-off download.
 */
export function decodeFeed(buffer: Uint8Array): Feed {
  const reader = new Reader(buffer);
  const feed: Feed = { timestamp: null, entities: [] };
  eachField(reader, (field, wireType) => {
    if (field === 1 && isMessage(wireType)) feed.timestamp = readHeaderTimestamp(reader.message()); // FeedMessage.header = 1
    else if (field === 2 && isMessage(wireType)) feed.entities.push(readEntity(reader.message())); // FeedMessage.entity = 2
    else return false;
    return true;
  });
  return feed;
}
