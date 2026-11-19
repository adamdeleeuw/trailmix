import { Schema, model } from 'mongoose';

/**
 * A shared counter in the `usages` collection, like the number of plans made today by all users.
 *
 * @remarks
 * Kept in MongoDB, not memory, so restarts and deploys don't reset the caps that bound the Google bill.
 */
export interface Usage {
  _id: string; // what is counted and for which period, e.g. "plans:day:2026-11-18"
  count: number;
  expiresAt: Date; // MongoDB deletes the counter after this, once its period is over
}

const usageSchema = new Schema<Usage>({
  _id: { type: String, required: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const UsageModel = model<Usage>('Usage', usageSchema); // Mongoose model for the usages collection
