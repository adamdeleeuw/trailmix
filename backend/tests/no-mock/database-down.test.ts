import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../../src/app';
import { connectDatabase } from '../../src/config/db';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

jest.setTimeout(30_000);

// a response may take a little over 5 s, since the 5 s timeout starts after the request reaches the backend
const OUTAGE_RESPONSE_MS = 6000;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// the database the test file is using, so the outage can end by reconnecting to it
function testDatabaseUri(): string {
  const { host, port, name } = mongoose.connection;
  return `mongodb://${host}:${port}/${name}`;
}

// Interface every signed-in endpoint and GET /health (decision 6)
describe('Unmocked: database unreachable', () => {
  // Input: the backend loses its MongoDB connection, then serves GET /api/users/me and GET /health; then MongoDB
  // comes back
  // Expected status code: 503 within about 5 s for both, then 200 and 200 again without a restart
  // Expected behavior: requests fail fast and say so, and the same app recovers on its own
  // Expected output: { error } with a generic message while down; the user and { status: "ok" } after
  test('Returns 503 quickly while the database is down, and recovers without a restart', async () => {
    const app = createApp();
    const { token } = await createSignedInUser();
    const uri = testDatabaseUri();
    await mongoose.disconnect();

    try {
      const startedAt = Date.now();
      const me = await request(app).get('/api/users/me').set('Authorization', bearer(token));
      expect(Date.now() - startedAt).toBeLessThan(OUTAGE_RESPONSE_MS);
      expect(me.status).toBe(503);
      expect(Object.keys(me.body as object)).toEqual(['error']);
      expect(me.body.error).not.toMatch(/mongo|buffering|timed out|sessions/i);

      const health = await request(app).get('/health');
      expect(health.status).toBe(503);
    } finally {
      await connectDatabase(uri);
    }

    expect((await request(app).get('/api/users/me').set('Authorization', bearer(token))).status).toBe(200);
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
  });
});
