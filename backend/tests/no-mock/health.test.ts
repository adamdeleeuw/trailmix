import request from 'supertest';

import { createApp } from '../../src/app';
import { useTestDatabase } from '../helpers/db';

// /health now reports the database too (issue #89, decision 6), so the healthy case needs one
useTestDatabase();

// Interface GET /health
describe('Unmocked: GET /health', () => {
  // Input: GET request to /health while connected to MongoDB
  // Expected status code: 200
  // Expected behavior: service reports healthy status
  // Expected output: { status: "ok" }
  test('Healthy service', async () => {
    const response = await request(createApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

// Interface GET /does-not-exist
describe('Unmocked: GET /does-not-exist', () => {
  // Input: GET request to an unregistered route
  // Expected status code: 404
  // Expected behavior: request is rejected; no state is changed
  // Expected output: { error: "Not Found" }
  test('Unregistered route', async () => {
    const response = await request(createApp()).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not Found' });
  });
});
