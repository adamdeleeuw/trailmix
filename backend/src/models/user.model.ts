import { Schema, model, type Types } from 'mongoose';

/**
 * A Trailmix account, stored in the `users` collection.
 *
 * @remarks
 * Users are identified by their Google account ID (`googleId`), never by email,
 * because a Google account's email can change but its ID can't. The unique index
 * on `googleId` makes the database refuse a second account for the same Google
 * account, even when two sign-ins race.
 */
export interface User {
  _id: Types.ObjectId;
  googleId: string; // Google's `sub` claim for the account
  email: string; // refreshed from Google on every sign-in
  name: string; // refreshed from Google on every sign-in
  photoUrl: string | null; // Google profile photo, refreshed on every sign-in (null if Google has none)
  profileComplete: boolean; // whether the commute questionnaire has been submitted
  createdAt: Date;
  updatedAt: Date;
}

/** The account fields the app is allowed to see. */
export interface UserResponse {
  id: string;
  email: string;
  name: string;
  photoUrl: string | null;
  profileComplete: boolean;
}

const userSchema = new Schema<User>(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
    photoUrl: { type: String, default: null },
    profileComplete: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

export const UserModel = model<User>('User', userSchema); // Mongoose model for the users collection

/**
 * Converts a stored user into the shape sent to the app.
 *
 * @param user - The stored user.
 * @returns The public account fields, without `googleId` or timestamps.
 */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    photoUrl: user.photoUrl,
    profileComplete: user.profileComplete,
  };
}
