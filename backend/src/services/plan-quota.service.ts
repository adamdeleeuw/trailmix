import mongoose from 'mongoose';
import { UsageModel } from '../models/usage.model';
import { bcDay, bcMonth, nextBcMidnight, nextBcMonth } from './bc-time';

// all users together, sized so the worst month costs about US$31 (see the issue #89 plan, decision 5)
const DEFAULT_DAILY_CAP = 60;
const DEFAULT_MONTHLY_CAP = 900;
const DUPLICATE_KEY = 11000;
const KEEP_AFTER_PERIOD_MS = 24 * 60 * 60 * 1000; // a day of slack before a finished counter is deleted

// an operator can raise a cap in backend/.env for a grading day, without a code change
function cap(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

// adds one to counter [id] unless it has reached [limit], in one atomic step so concurrent plans can't overshoot
async function take(id: string, limit: number, periodEnd: number): Promise<boolean> {
  const filter = { _id: id, count: { $lt: limit } };
  const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(periodEnd + KEEP_AFTER_PERIOD_MS) } };
  try {
    // either adds one to a counter under the limit, or creates the period's counter at 1
    await UsageModel.updateOne(filter, update, { upsert: true });
    return true;
  } catch (error) {
    // the counter exists and is full (so the upsert tried to insert a second one), or two plans created it at once
    if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== DUPLICATE_KEY) throw error;
    return (await UsageModel.updateOne(filter, { $inc: { count: 1 } })).modifiedCount === 1;
  }
}

/**
 * Counts one plan against the all-users daily and monthly caps, before any Google call is made.
 *
 * @returns `undefined` if the plan may go ahead, or the whole seconds until the cap that refused it resets.
 * @throws If the database operation fails.
 */
export async function reservePlan(): Promise<number | undefined> {
  const now = new Date();
  const dayId = `plans:day:${bcDay(now)}`;
  const dayEnd = nextBcMidnight(now).getTime();
  const monthEnd = nextBcMonth(now).getTime();
  const secondsUntil = (instant: number): number => Math.ceil((instant - now.getTime()) / 1000);

  if (!(await take(dayId, cap('PLAN_DAILY_CAP', DEFAULT_DAILY_CAP), dayEnd))) return secondsUntil(dayEnd);
  if (await take(`plans:month:${bcMonth(now)}`, cap('PLAN_MONTHLY_CAP', DEFAULT_MONTHLY_CAP), monthEnd)) {
    return undefined;
  }
  await UsageModel.updateOne({ _id: dayId }, { $inc: { count: -1 } }); // the plan isn't made, so it doesn't count today
  return secondsUntil(monthEnd);
}
