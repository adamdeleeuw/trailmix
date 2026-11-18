/**
 * Keeps the backend under TransLink's daily request limit (#87).
 *
 * @remarks
 * TransLink allows 1,000 requests a day per key, so the backend stops at {@link DAILY_REQUEST_CAP}, which leaves room
 * for requests made by hand with the same key. The day resets at midnight Pacific time, which is a fixed UTC-7 (see
 * `bc-time.ts`).
 */
import { mongo } from 'mongoose';
import { TranslinkQuotaModel } from '../models/translink-quota.model';
import { bcDay } from './bc-time';

/** The most requests the backend sends TransLink in one Pacific day. */
export const DAILY_REQUEST_CAP = 950;
const LOG_EVERY = 100; // log the running count every this many requests
const DUPLICATE_KEY = 11000;

/** The Pacific-time day a moment falls on, as YYYY-MM-DD. Midnight Pacific is 07:00 UTC all year. */
export function pacificDay(at: Date): string {
  return bcDay(at);
}

/**
 * Counts one request against today's cap, if there's room for it.
 *
 * @remarks
 * One atomic update: it only matches today's count while it's under the cap, so two polls racing can't both take
 * the last request. When today's count is at the cap, the upsert tries to insert a second document for the day,
 * which the `_id` index refuses; the same happens when two requests start a day together, so it tries once more
 * without inserting, and only a miss then means "capped". Logs the count every {@link LOG_EVERY} requests and when
 * the cap is reached, so the day's usage shows in the server log.
 *
 * @param at - When the request would be sent.
 * @returns Whether the request may be sent.
 * @throws If the database operation fails for any other reason.
 */
export async function reserveTranslinkRequest(at: Date): Promise<boolean> {
  const day = pacificDay(at);
  const filter = { _id: day, count: { $lt: DAILY_REQUEST_CAP } };
  const increment = { $inc: { count: 1 } };
  let updated: { count: number } | null;
  try {
    updated = await TranslinkQuotaModel.findOneAndUpdate(filter, increment, { upsert: true, returnDocument: 'after', lean: true });
  } catch (err) {
    if (!(err instanceof mongo.MongoServerError) || err.code !== DUPLICATE_KEY) throw err;
    // the day's document exists: either it's at the cap, or another request created it at the same moment
    updated = await TranslinkQuotaModel.findOneAndUpdate(filter, increment, { returnDocument: 'after', lean: true });
  }
  if (updated === null) return false;
  const { count } = updated;
  if (count === DAILY_REQUEST_CAP) {
    console.warn(`TransLink requests on ${day} (Pacific): ${count}/${DAILY_REQUEST_CAP}, the cap; live updates pause until midnight`);
  } else if (count % LOG_EVERY === 0 || count === 1) {
    console.log(`TransLink requests on ${day} (Pacific): ${count}/${DAILY_REQUEST_CAP}`);
  }
  return true;
}

/**
 * How many requests the backend has sent TransLink on the day `at` falls on.
 *
 * @param at - Any moment of the day.
 * @returns The count, 0 for a day with no requests.
 */
export async function translinkRequestsOn(at: Date): Promise<number> {
  const doc = await TranslinkQuotaModel.findById(pacificDay(at)).lean();
  return doc?.count ?? 0;
}
