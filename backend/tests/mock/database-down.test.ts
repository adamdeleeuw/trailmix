import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../../src/app';
import { SessionModel } from '../../src/models/session.model';
import { UserModel } from '../../src/models/user.model';
import { bearer, createSignedInUser } from '../helpers/auth';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// a Mongoose query whose .lean() fails the way the MongoDB driver does when the server can't be reached
function unreachableQuery(error: Error): never {
  return { lean: () => Promise.reject(error) } as never;
}

const OUTAGES: [string, Error][] = [
  ['the network to MongoDB fails', new mongoose.mongo.MongoNetworkError('connect ECONNREFUSED 10.0.0.5:27017')],
  ['no MongoDB server can be selected', new mongoose.Error.MongooseServerSelectionError('Server selection timed out after 5000 ms')],
];

// a generic database error message, with nothing from MongoDB in it
function expectGenericUnavailable(response: request.Response): void {
  expect(Object.keys(response.body as object)).toEqual(['error']);
  expect(response.body.error).not.toMatch(/mongo|ECONNREFUSED|27017|selection|timed out/i);
}

// Interface every signed-in endpoint (decision 6: a database outage is a 503, not a 500)
describe('Mocked: database unreachable', () => {
  // Mocked behavior: the session lookup fails because MongoDB can't be reached
  // Input: GET /api/users/me with a valid session token
  // Expected status code: 503
  // Expected behavior: the outage is reported as temporary, without MongoDB details
  // Expected output: { error } with a generic message
  test.each(OUTAGES)('Returns 503 when %s during the session lookup', async (_name, error) => {
    const { token } = await createSignedInUser();
    jest.spyOn(SessionModel, 'findOne').mockReturnValueOnce(unreachableQuery(error));

    const response = await request(createApp()).get('/api/users/me').set('Authorization', bearer(token));

    expect(response.status).toBe(503);
    expectGenericUnavailable(response);
  });

  // Mocked behavior: the user lookup fails because MongoDB can't be reached
  // Input: GET /api/users/me/trips with a valid session token
  // Expected status code: 503
  // Expected behavior: the outage is reported as temporary, without MongoDB details
  // Expected output: { error } with a generic message
  test.each(OUTAGES)('Returns 503 when %s while loading user data', async (_name, error) => {
    const { token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findById').mockReturnValueOnce(unreachableQuery(error));

    const response = await request(createApp()).get('/api/users/me/trips').set('Authorization', bearer(token));

    expect(response.status).toBe(503);
    expectGenericUnavailable(response);
  });
});
