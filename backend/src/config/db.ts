import mongoose, { connect, disconnect } from 'mongoose';
import { SessionModel } from '../models/session.model';
import { UsageModel } from '../models/usage.model';
import { UserModel } from '../models/user.model';

// a query fails within about 5 s when MongoDB is down, instead of hanging for Mongoose's and the driver's 10 to 30 s
// defaults, so the app gets a quick 503
const OUTAGE_TIMEOUT_MS = 5000;

/**
 * Connects to MongoDB and waits until every model's indexes exist.
 *
 * @remarks
 * Waiting for the indexes matters: the unique indexes on `users.googleId` and
 * `sessions.tokenHash` are what keep concurrent sign-ins from creating duplicates.
 *
 * @param uri - MongoDB connection string, including the database name.
 * @throws If the server can't be reached or an index can't be built.
 */
export async function connectDatabase(uri: string): Promise<void> {
  mongoose.set('bufferTimeoutMS', OUTAGE_TIMEOUT_MS);
  await connect(uri, { serverSelectionTimeoutMS: OUTAGE_TIMEOUT_MS });
  await Promise.all([UserModel.init(), SessionModel.init(), UsageModel.init()]);
}

/** Closes the MongoDB connection. */
export async function disconnectDatabase(): Promise<void> {
  await disconnect();
}
