import { Schema, model, type Types } from 'mongoose';

/**
 * A signed-in device, stored in the `sessions` collection.
 *
 * @remarks
 * Only a SHA-256 hash of the session token is stored, so a leaked database can't
 * be used to sign in. A session ends when its device signs out, when the account
 * is deleted, after {@link SESSION_IDLE_DAYS} days unused, or {@link SESSION_MAX_DAYS}
 * days after sign-in, so a stolen token stops working on its own.
 */
export interface Session {
  _id: Types.ObjectId;
  tokenHash: string; // hex SHA-256 hash of the token the app holds
  userId: Types.ObjectId; // the account this session signs in as
  createdAt: Date;
  lastUsedAt?: Date; // recorded at most once a day; missing on sessions from before issue #89 until their next use
}

export const SESSION_IDLE_DAYS = 30; // a session unused this long ends
export const SESSION_MAX_DAYS = 90; // and none lasts longer than this after sign-in
const DAY_SECONDS = 24 * 60 * 60;

const sessionSchema = new Schema<Session>(
  {
    tokenHash: { type: String, required: true, unique: true },
    // indexed so deleting an account can end all of its sessions in one query
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastUsedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// MongoDB deletes expired sessions (its TTL monitor runs about once a minute, so lookups also check the dates)
sessionSchema.index({ lastUsedAt: 1 }, { expireAfterSeconds: SESSION_IDLE_DAYS * DAY_SECONDS });
sessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: SESSION_MAX_DAYS * DAY_SECONDS });

export const SessionModel = model<Session>('Session', sessionSchema); // Mongoose model for the sessions collection
