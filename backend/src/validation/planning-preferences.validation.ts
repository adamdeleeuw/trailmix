import {
  PLANNING_MODES,
  type PlanningPreferences,
} from '../models/user.model';
import { isRecord } from './common.validation';

/** Validates the complete preferences payload; unknown modes and empty selections are rejected. */
export function parsePlanningPreferences(body: unknown): PlanningPreferences | undefined {
  if (!isRecord(body)) return undefined;
  const { costVsTime, defaultModes } = body;
  if (typeof costVsTime !== 'number' || !Number.isInteger(costVsTime) || costVsTime < 0 || costVsTime > 100) {
    return undefined;
  }
  if (!Array.isArray(defaultModes) || defaultModes.length === 0) return undefined;
  if (defaultModes.some((mode) => !PLANNING_MODES.includes(mode as (typeof PLANNING_MODES)[number]))) return undefined;
  if (new Set(defaultModes).size !== defaultModes.length) return undefined;
  return { costVsTime, defaultModes: [...defaultModes] as PlanningPreferences['defaultModes'] };
}