import { Schema, model } from 'mongoose';

/**
 * How many requests the backend sent TransLink's API on one day, stored in the `translink_quota` collection (#87).
 *
 * @remarks
 * TransLink caps a key at 1,000 requests a day, so the count lives in the database rather than in memory, and a
 * restart or redeploy partway through a day can't reset it.
 */
export interface TranslinkQuotaDay {
  _id: string; // the day in Pacific time, as YYYY-MM-DD, since TransLink's day starts at midnight in Vancouver
  count: number; // requests sent that day
}

const translinkQuotaSchema = new Schema<TranslinkQuotaDay>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, min: 0 },
  },
  { versionKey: false, collection: 'translink_quota' },
);

export const TranslinkQuotaModel = model<TranslinkQuotaDay>('TranslinkQuota', translinkQuotaSchema);
