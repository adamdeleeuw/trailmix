import {
  MAX_MAX_WALK_MINUTES,
  MIN_MAX_WALK_MINUTES,
  PLANNING_MODES,
  type PlanningPreferences,
} from '../models/user.model';
import { isRecord } from './common.validation';

/** Whether a value is a whole number of minutes the max walk can be set to. */
export function isMaxWalkMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= MIN_MAX_WALK_MINUTES && value <= MAX_MAX_WALK_MINUTES;
}

/**
 * Validates the preferences payload; unknown modes and empty selections are rejected.
 * `maxWalkMinutes` is optional, so older clients that don't send it keep the saved value.
 */
export function parsePlanningPreferences(body: unknown): PlanningPreferences | undefined {
  if (!isRecord(body)) return undefined;
  const { costVsTime, defaultModes, maxWalkMinutes } = body;
  if (maxWalkMinutes !== undefined && !isMaxWalkMinutes(maxWalkMinutes)) return undefined;
  if (typeof costVsTime !== 'number' || !Number.isInteger(costVsTime) || costVsTime < 0 || costVsTime > 100) {
    return undefined;
  }
  if (!Array.isArray(defaultModes) || defaultModes.length === 0) return undefined;
  if (defaultModes.some((mode) => !PLANNING_MODES.includes(mode as (typeof PLANNING_MODES)[number]))) return undefined;
  if (new Set(defaultModes).size !== defaultModes.length) return undefined;
  return {
    costVsTime,
    defaultModes: [...defaultModes] as PlanningPreferences['defaultModes'],
    ...(maxWalkMinutes === undefined ? {} : { maxWalkMinutes }),
  };
}