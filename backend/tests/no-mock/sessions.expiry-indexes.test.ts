import mongoose from 'mongoose';

import { useTestDatabase } from '../helpers/db';

useTestDatabase();

const DAY_SECONDS = 24 * 60 * 60;

// Interface the sessions collection (issue #89: expired sessions are deleted from the database)
describe('Unmocked: sessions collection', () => {
  // Input: the indexes on the sessions collection after the backend connects
  // Expected behavior: MongoDB deletes a session 30 days after its last use, and 90 days after sign-in
  // Expected output: TTL indexes of 30 days on lastUsedAt and 90 days on createdAt
  test('Has expiry indexes for 30 days unused and 90 days after sign-in', async () => {
    const indexes = await mongoose.connection.collection('sessions').indexes();
    const ttl = indexes
      .filter((index) => index.expireAfterSeconds !== undefined)
      .map((index) => ({ key: index.key, expireAfterSeconds: index.expireAfterSeconds }));

    expect(ttl).toEqual(expect.arrayContaining([
      { key: { lastUsedAt: 1 }, expireAfterSeconds: 30 * DAY_SECONDS },
      { key: { createdAt: 1 }, expireAfterSeconds: 90 * DAY_SECONDS },
    ]));
    expect(ttl).toHaveLength(2);
  });
});
