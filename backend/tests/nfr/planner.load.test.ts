import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import request from 'supertest';

import { createApp } from '../../src/app';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';
import { googleAnswer, TRANSIT_PLAN, wait } from '../helpers/google';

useTestDatabase();

interface GoogleLatencies {
  transitMatrixMs: number;
  routeDetailsMs: number;
}

const latencies = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'planner-google-latencies.json'), 'utf8')) as GoogleLatencies;
const USERS = 50;
const PLANS_PER_USER = 4; // 200 plans in all
const CONCURRENCY = 20;
const TEST_TIMEOUT_MS = 120_000;

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.PLAN_DAILY_CAP;
  delete process.env.PLAN_MONTHLY_CAP;
});

// the value below which [fraction] of the sorted [samples] fall
function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? Number.NaN;
}

describe('NFR: planner under load', () => {
  // Mocked behavior: Google answers at the recorded latencies; the shared caps are raised in the environment, as
  //                  the plan says an operator would for a load test
  // Input: 200 plans from 50 users on 50 addresses, 20 in flight at a time, through one app instance
  // Expected status code: never 500
  // Expected behavior: the limits and the Google call cap hold up under load without errors
  // Expected output: requests per second, median and 95th-percentile latency, and the 429 and 503 counts, logged for
  //                  the Testing.md write-up
  test('serves 200 plans from 50 users, 20 at a time, without a 500', async () => {
    process.env.PLAN_DAILY_CAP = '1000';
    process.env.PLAN_MONTHLY_CAP = '1000';
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      await wait(String(input).includes('computeRouteMatrix') ? latencies.transitMatrixMs : latencies.routeDetailsMs);
      return new Response(JSON.stringify(googleAnswer(input)), { status: 200 });
    });
    const app = createApp();
    const tokens = await Promise.all(Array.from({ length: USERS }, async () => (await createSignedInUser()).token));
    const queue = tokens.flatMap((token, user) => Array.from({ length: PLANS_PER_USER }, () => ({ token, user })));
    const samples: number[] = [];
    const statuses = new Map<number, number>();

    const startedAt = performance.now();
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const sentAt = performance.now();
        const response = await request(app).post('/api/routes/plan').set('Authorization', bearer(next.token))
          .set('X-Forwarded-For', `198.51.100.${next.user}`).send(TRANSIT_PLAN);
        samples.push(performance.now() - sentAt);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      }
    }));
    const elapsedSeconds = (performance.now() - startedAt) / 1000;

    console.log([
      `Planner load: ${samples.length} plans in ${elapsedSeconds.toFixed(1)} s (${(samples.length / elapsedSeconds).toFixed(1)} per second)`,
      `median ${percentile(samples, 0.5).toFixed(1)} ms, p95 ${percentile(samples, 0.95).toFixed(1)} ms`,
      `statuses ${JSON.stringify(Object.fromEntries(statuses))}`,
    ].join('; '));
    expect(samples).toHaveLength(USERS * PLANS_PER_USER);
    expect(statuses.get(500)).toBeUndefined();
  }, TEST_TIMEOUT_MS);
});
