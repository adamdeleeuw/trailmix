import { PLANNING_MODES } from '../models/user.model';
import type { PlannerPlace } from '../services/planner.core';
import type { PlannerMode } from '../services/planner.google.service';
import { isRecord } from './common.validation';
import { isMaxWalkMinutes } from './planning-preferences.validation';

export interface PlanRequest {
  origin: PlannerPlace;
  destination: PlannerPlace;
  arriveBy: Date | null;
  modes: PlannerMode[];
  costVsTime?: number;
  maxWalkMinutes?: number; // overrides the saved preference for this trip
}

export type PlanRequestParseResult = { request: PlanRequest } | { error: string };

function parsePlace(value: unknown): PlannerPlace | null {
  if (!isRecord(value)) return null;
  const { label, lat, lng, placeId } = value;
  if (typeof label !== 'string' || label.trim().length === 0) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  if (placeId !== null && typeof placeId !== 'string') return null;
  return { label, lat, lng, placeId };
}

/** Parses the planner contract without allowing malformed requests to reach Google or MongoDB. */
export function parsePlanRequest(body: unknown): PlanRequestParseResult {
  if (!isRecord(body)) return { error: 'body must be an object' };
  const origin = parsePlace(body.origin);
  if (origin === null) return { error: 'origin must be a valid Place' };
  const destination = parsePlace(body.destination);
  if (destination === null) return { error: 'destination must be a valid Place' };
  if (body.arriveBy !== null) {
    if (typeof body.arriveBy !== 'string' || Number.isNaN(Date.parse(body.arriveBy))) {
      return { error: 'arriveBy must be an ISO-8601 date or null' };
    }
  }
  if (!Array.isArray(body.modes) || body.modes.length === 0) return { error: 'modes must contain DRIVE and/or TRANSIT' };
  if (body.modes.some((mode) => !PLANNING_MODES.includes(mode as (typeof PLANNING_MODES)[number]))) {
    return { error: 'modes contains an unknown mode' };
  }
  if (new Set(body.modes).size !== body.modes.length) return { error: 'modes must not contain duplicates' };
  if (body.costVsTime !== undefined && (
    typeof body.costVsTime !== 'number' ||
    !Number.isInteger(body.costVsTime) ||
    body.costVsTime < 0 ||
    body.costVsTime > 100
  )) return { error: 'costVsTime must be an integer from 0 to 100' };
  if (body.maxWalkMinutes !== undefined && !isMaxWalkMinutes(body.maxWalkMinutes)) {
    return { error: 'maxWalkMinutes must be an integer from 1 to 60' };
  }
  return {
    request: {
      origin,
      destination,
      arriveBy: body.arriveBy === null ? null : new Date(body.arriveBy as string),
      modes: [...body.modes] as PlannerMode[],
      ...(body.costVsTime === undefined ? {} : { costVsTime: body.costVsTime as number }),
      ...(body.maxWalkMinutes === undefined ? {} : { maxWalkMinutes: body.maxWalkMinutes as number }),
    },
  };
}