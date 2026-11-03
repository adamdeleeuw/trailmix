import type { Place } from '../models/trip.model';

export interface NormalizableLeg {
  mode: 'DRIVE' | 'TRANSIT' | 'WALK';
  from: Place;
  to: Place;
  departAt: string;
  arriveAt: string;
  durationSeconds: number;
  distanceMeters: number;
  costCents: number;
  polyline: string;
  transitLines: Array<{
    name: string;
    vehicle: string;
    colour: string;
    headsign: string;
    departureStop: string;
    arrivalStop: string;
    stopCount: number;
  }>;
}

const POLYLINE_SCALE = 1e5;
const ASCII_OFFSET = 63;
const CHUNK_MASK = 0x1f;
const CONTINUE_BIT = 0x20;
const WALK_TRIVIAL_MAX_SECONDS = 60;
const WALK_TRIVIAL_MAX_METERS = 50;
const TRANSIT_CONNECTION_LABEL = 'Transit connection';

function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  function nextDelta(): number {
    let result = 0;
    let shift = 0;
    let chunk: number;
    do {
      if (index >= encoded.length) throw new Error('Truncated encoded polyline');
      chunk = encoded.charCodeAt(index++) - ASCII_OFFSET;
      if (chunk < 0 || chunk > 63) throw new Error('Invalid encoded polyline character');
      result |= (chunk & CHUNK_MASK) << shift;
      shift += 5;
    } while (chunk >= CONTINUE_BIT);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    latitude += nextDelta();
    if (index >= encoded.length) throw new Error('Encoded polyline has an incomplete coordinate pair');
    longitude += nextDelta();
    points.push([latitude / POLYLINE_SCALE, longitude / POLYLINE_SCALE]);
  }
  if (points.length === 0) throw new Error('Encoded polyline is empty');
  return points;
}

function encodeDelta(delta: number): string {
  let value = delta < 0 ? ~(delta << 1) : delta << 1;
  let encoded = '';
  while (value >= CONTINUE_BIT) {
    encoded += String.fromCharCode(((value & CHUNK_MASK) | CONTINUE_BIT) + ASCII_OFFSET);
    value >>= 5;
  }
  return encoded + String.fromCharCode(value + ASCII_OFFSET);
}

function encodePolyline(points: readonly [number, number][]): string {
  let latitude = 0;
  let longitude = 0;
  let encoded = '';
  for (const [nextLatitude, nextLongitude] of points) {
    const scaledLatitude = Math.round(nextLatitude * POLYLINE_SCALE);
    const scaledLongitude = Math.round(nextLongitude * POLYLINE_SCALE);
    encoded += encodeDelta(scaledLatitude - latitude);
    encoded += encodeDelta(scaledLongitude - longitude);
    latitude = scaledLatitude;
    longitude = scaledLongitude;
  }
  return encoded;
}

function combinePolylines(first: string, second: string): string {
  const firstPoints = decodePolyline(first);
  const secondPoints = decodePolyline(second);
  const last = firstPoints[firstPoints.length - 1];
  const start = secondPoints[0];
  const continuesAtSamePoint = last?.[0] === start?.[0] && last?.[1] === start?.[1];
  return encodePolyline([...firstPoints, ...secondPoints.slice(continuesAtSamePoint ? 1 : 0)]);
}

function isUsefulLabel(label: string): boolean {
  return label.trim() !== '' && label !== TRANSIT_CONNECTION_LABEL;
}

function labelPlace(place: Place, label: string): Place {
  return { ...place, label };
}

function absorbWalkIntoNext(walk: NormalizableLeg, next: NormalizableLeg): NormalizableLeg {
  return {
    ...next,
    from: walk.from,
    departAt: walk.departAt,
    durationSeconds: walk.durationSeconds + next.durationSeconds,
    distanceMeters: walk.distanceMeters + next.distanceMeters,
    costCents: walk.costCents + next.costCents,
    polyline: combinePolylines(walk.polyline, next.polyline),
  };
}

function absorbWalkIntoPrevious(previous: NormalizableLeg, walk: NormalizableLeg): NormalizableLeg {
  return {
    ...previous,
    to: walk.to,
    arriveAt: walk.arriveAt,
    durationSeconds: previous.durationSeconds + walk.durationSeconds,
    distanceMeters: previous.distanceMeters + walk.distanceMeters,
    costCents: previous.costCents + walk.costCents,
    polyline: combinePolylines(previous.polyline, walk.polyline),
  };
}

function mergeWalkGroup(legs: readonly NormalizableLeg[]): NormalizableLeg {
  const first = legs[0];
  if (first === undefined) throw new Error('Cannot merge an empty walk group');
  return legs.slice(1).reduce((merged, leg) => ({
    ...merged,
    to: leg.to,
    arriveAt: leg.arriveAt,
    durationSeconds: merged.durationSeconds + leg.durationSeconds,
    distanceMeters: merged.distanceMeters + leg.distanceMeters,
    costCents: merged.costCents + leg.costCents,
    polyline: combinePolylines(merged.polyline, leg.polyline),
  }), first);
}

/**
 * Combines turn-by-turn walking steps into journey legs without changing summed
 * duration, distance, or cost.
 */
export function normalizeRouteLegs(
  input: readonly NormalizableLeg[],
  origin: Place,
  destination: Place,
): NormalizableLeg[] {
  const grouped: NormalizableLeg[] = [];
  for (let index = 0; index < input.length;) {
    const leg = input[index];
    if (leg === undefined) break;
    if (leg.mode !== 'WALK') {
      grouped.push(leg);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (input[end]?.mode === 'WALK') end += 1;
    grouped.push(mergeWalkGroup(input.slice(index, end)));
    index = end;
  }

  const normalized = [...grouped];
  for (let index = 0; index < normalized.length;) {
    const walk = normalized[index];
    if (walk?.mode !== 'WALK' || walk.durationSeconds >= WALK_TRIVIAL_MAX_SECONDS ||
      walk.distanceMeters >= WALK_TRIVIAL_MAX_METERS || normalized.length === 1) {
      index += 1;
      continue;
    }

    const previous = normalized[index - 1];
    const next = normalized[index + 1];
    if (next !== undefined && next.mode !== 'WALK') {
      normalized.splice(index, 2, absorbWalkIntoNext(walk, next));
    } else if (previous !== undefined && previous.mode !== 'WALK') {
      normalized.splice(index - 1, 2, absorbWalkIntoPrevious(previous, walk));
      index = Math.max(0, index - 1);
    } else {
      index += 1;
    }
  }

  return normalized.map((leg, index) => {
    const previous = normalized[index - 1];
    const next = normalized[index + 1];
    if (leg.mode === 'WALK') {
      const fromLabel = isUsefulLabel(leg.from.label)
        ? leg.from.label
        : previous !== undefined && isUsefulLabel(previous.to.label)
          ? previous.to.label
          : origin.label;
      const toLabel = isUsefulLabel(leg.to.label)
        ? leg.to.label
        : next !== undefined && next.mode === 'TRANSIT' &&
            isUsefulLabel(next.transitLines[0]?.departureStop ?? '')
          ? next.transitLines[0]?.departureStop ?? destination.label
          : next !== undefined && isUsefulLabel(next.from.label)
            ? next.from.label
            : destination.label;
      return { ...leg, from: labelPlace(leg.from, fromLabel), to: labelPlace(leg.to, toLabel) };
    }

    const line = leg.transitLines[0];
    const fromLabel = isUsefulLabel(leg.from.label)
      ? leg.from.label
      : isUsefulLabel(line?.departureStop ?? '')
        ? line?.departureStop ?? origin.label
        : previous !== undefined && isUsefulLabel(previous.to.label)
          ? previous.to.label
          : origin.label;
    const toLabel = isUsefulLabel(leg.to.label)
      ? leg.to.label
      : isUsefulLabel(line?.arrivalStop ?? '')
        ? line?.arrivalStop ?? destination.label
        : next !== undefined && isUsefulLabel(next.from.label)
          ? next.from.label
          : destination.label;
    return { ...leg, from: labelPlace(leg.from, fromLabel), to: labelPlace(leg.to, toLabel) };
  });
}
