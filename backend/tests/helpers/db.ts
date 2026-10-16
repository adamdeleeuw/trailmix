import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/db';

/**
 * Connects the calling test file to its own database on the test MongoDB.
 *
 * @remarks
 * Uses `MONGODB_TEST_URI` (default `mongodb://localhost:27017`, the docker
 * compose `mongo` container). Each Jest worker gets its own database so test
 * files running in parallel can't interfere. Collections are emptied after
 * every test and the database is dropped after the file.
 */
export function useTestDatabase(): void {
  const baseUri = process.env.MONGODB_TEST_URI ?? 'mongodb://localhost:27017';
  const dbName = `trailmix-test-${process.env.JEST_WORKER_ID ?? '0'}`;

  beforeAll(async () => {
    await connectDatabase(`${baseUri}/${dbName}`);
  });

  afterEach(async () => {
    await Promise.all(
      Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
    );
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });
}

/**
 * Builds a stand-in for a Mongoose query whose `.lean()` rejects, for faking
 * database errors with `jest.spyOn(Model, 'findOne').mockReturnValueOnce(...)`.
 */
export function failingQuery(): never {
  return { lean: () => Promise.reject(new Error('Simulated database error')) } as never;
}
