import type { TransitLineDetail } from './planner.google.service';

const SKYTRAIN_STATION_ZONES: Readonly<Record<string, 1 | 2 | 3>> = {
  'Burrard': 1,
  'Commercial-Broadway': 1,
  'Granville': 1,
  'King George': 3,
  'Lansdowne': 2,
  'Metrotown': 2,
  'New Westminster': 2,
  'Production Way-University': 2,
  'Richmond-Brighouse': 2,
  'Surrey Central': 3,
  'Vancouver City Centre': 1,
  'Waterfront': 1,
};

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase('en-CA');
}

function stationZone(name: string): number | undefined {
  const entry = Object.entries(SKYTRAIN_STATION_ZONES).find(([station]) => normalizedName(station) === normalizedName(name));
  return entry?.[1];
}

/** Estimates zones crossed; buses count as one, with known SkyTrain endpoints overriding that fallback. */
export function zonesForTransitLines(lines: readonly TransitLineDetail[]): number {
  let zones = 1;
  for (const line of lines) {
    if (/skytrain|rapid transit|subway|expo line|millennium line|canada line/i.test(`${line.name} ${line.vehicle}`)) {
      const departure = stationZone(line.departureStop);
      const arrival = stationZone(line.arrivalStop);
      if (departure !== undefined && arrival !== undefined) zones = Math.max(zones, Math.abs(arrival - departure) + 1);
    }
  }
  return Math.min(3, zones);
}