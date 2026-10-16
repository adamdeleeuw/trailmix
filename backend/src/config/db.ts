import { connect, disconnect } from 'mongoose';
import { SessionModel } from '../models/session.model';
import { UserModel } from '../models/user.model';

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
  await connect(uri);
  await Promise.all([UserModel.init(), SessionModel.init()]);
}

/** Closes the MongoDB connection. */
export async function disconnectDatabase(): Promise<void> {
  await disconnect();
}
