import { Schema, model, type Types } from 'mongoose';

/**
 * A signed-in device, stored in the `sessions` collection.
 *
 * @remarks
 * Only a SHA-256 hash of the session token is stored, so a leaked database can't
 * be used to sign in. Sessions never expire on their own: one ends when its
 * device signs out, and all of a user's sessions end when the account is deleted.
 */
export interface Session {
  _id: Types.ObjectId;
  tokenHash: string; // hex SHA-256 hash of the token the app holds
  userId: Types.ObjectId; // the account this session signs in as
  createdAt: Date;
}

const sessionSchema = new Schema<Session>(
  {
    tokenHash: { type: String, required: true, unique: true },
    // indexed so deleting an account can end all of its sessions in one query
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const SessionModel = model<Session>('Session', sessionSchema); // Mongoose model for the sessions collection
