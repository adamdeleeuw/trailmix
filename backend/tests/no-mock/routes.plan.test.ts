import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

const origin = { label: 'UBC', lat: 49.2606, lng: -123.246, placeId: 'ubc' };
const destination = { label: 'Downtown Vancouver', lat: 49.2827, lng: -123.1207, placeId: 'downtown' };
const validBody = { origin, destination, arriveBy: null, modes: ['TRANSIT'] };

function sendPlan(body: object | undefined, authorization?: string): request.Test {
  const test = request(createApp()).post('/api/routes/plan');
  if (authorization !== undefined) test.set('Authorization', authorization);
  return test.send(body);
}

// Interface POST /api/routes/plan
describe('Unmocked: POST /api/routes/plan', () => {
  // Input: valid body without a session
  // Expected status code: 401
  // Expected behavior: reject before validating or calling Google
  // Expected output: { error: "Unauthorized" }
  test('Rejects a missing session', async () => {
    const response = await sendPlan(validBody);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  // Input: valid session and request bodies with a missing place, invalid coordinate, unknown mode, invalid preference, or invalid date
  // Expected status code: 400
  // Expected behavior: reject each request before contacting Google
  // Expected output: a field-specific error message
  test('Rejects invalid request fields', async () => {
    const { token } = await createSignedInUser();
    const badBodies = [
      [{ ...validBody, origin: undefined }, 'origin'],
      [{ ...validBody, destination: { ...destination, lat: 91 } }, 'destination'],
      [{ ...validBody, modes: ['BIKE'] }, 'modes'],
      [{ ...validBody, costVsTime: 101 }, 'costVsTime'],
      [{ ...validBody, arriveBy: 'tomorrow afternoon' }, 'arriveBy'],
    ] as const;

    for (const [body, field] of badBodies) {
      const response = await sendPlan(body, bearer(token));
      expect(response.status).toBe(400);
      expect(response.body.error).toContain(field);
    }
  });
});