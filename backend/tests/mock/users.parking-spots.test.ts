import request from 'supertest';

import { createApp } from '../../src/app';
import { UserModel } from '../../src/models/user.model';
import { getParkingSpots } from '../../src/services/parking-spot.service';
import { bearer, createSignedInUser } from '../helpers/auth';
import { failingQuery, useTestDatabase } from '../helpers/db';
import { addParkingSpots, parkingSpotBody } from '../helpers/parking-spots';

useTestDatabase();

const PATH = '/api/users/me/parking-spots';

/** A stand-in for a Mongoose query whose `.lean()` resolves to `value`. */
function resolvingQuery(value: unknown): never {
  return { lean: () => Promise.resolve(value) } as never;
}

/**
 * Spies on `UserModel.findById` so the session check's lookup still works and
 * the next lookup returns `query` instead.
 */
function failNextUserLookupAfterSessionCheck(query: never): jest.SpyInstance {
  const realFindById = UserModel.findById.bind(UserModel);
  return jest.spyOn(UserModel, 'findById')
    .mockImplementationOnce(((...args: Parameters<typeof UserModel.findById>) => realFindById(...args)) as never)
    .mockReturnValueOnce(query);
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface GET /api/users/me/parking-spots
describe('Mocked: GET /api/users/me/parking-spots', () => {
  // Mocked behavior: reading the user's spots fails after the session check
  // Input: a valid session
  // Expected status code: 500
  // Expected behavior: error is handled without crashing
  // Expected output: { error: "Internal Server Error" }
  test('Database error while listing', async () => {
    const { token } = await createSignedInUser();
    const lookup = failNextUserLookupAfterSessionCheck(failingQuery());

    const response = await request(createApp()).get(PATH).set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  // Mocked behavior: the account is deleted between the session check and reading its spots
  // Input: a valid session for a user with a saved spot
  // Expected status code: 200
  // Expected behavior: a missing account has no spots, so the Planner and the app get an empty list
  // Expected output: { parkingSpots: [] }
  test('Account deleted while listing', async () => {
    const { user, token } = await createSignedInUser();
    await addParkingSpots(user._id, 1);
    failNextUserLookupAfterSessionCheck(resolvingQuery(null));

    const response = await request(createApp()).get(PATH).set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ parkingSpots: [] });
  });
});

// Interface POST /api/users/me/parking-spots
describe('Mocked: POST /api/users/me/parking-spots', () => {
  // Mocked behavior: saving the spot fails
  // Input: a valid session and a valid spot
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and nothing is saved
  // Expected output: { error: "Internal Server Error" }
  test('Database error while saving', async () => {
    const { user, token } = await createSignedInUser();
    const save = jest.spyOn(UserModel, 'findOneAndUpdate').mockReturnValueOnce(failingQuery());

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(await getParkingSpots(user._id)).toStrictEqual([]);
  });

  // Mocked behavior: the account is deleted between the session check and the save
  // Input: a valid session and a valid spot
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('Account deleted while saving', async () => {
    const { token } = await createSignedInUser();
    jest.spyOn(UserModel, 'findOneAndUpdate').mockReturnValueOnce(resolvingQuery(null));
    failNextUserLookupAfterSessionCheck(resolvingQuery(null));

    const response = await request(createApp()).post(PATH).set('Authorization', bearer(token)).send(parkingSpotBody());

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
  });
});

// Interface PUT /api/users/me/parking-spots/:id
describe('Mocked: PUT /api/users/me/parking-spots/:id', () => {
  // Mocked behavior: saving the new details fails
  // Input: a valid session, the id of the user's spot, and { label: "Renamed" }
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and the spot is unchanged
  // Expected output: { error: "Internal Server Error" }
  test('Database error while editing', async () => {
    const { user, token } = await createSignedInUser();
    const spots = await addParkingSpots(user._id, 1);
    jest.spyOn(UserModel, 'findOneAndUpdate').mockReturnValueOnce(failingQuery());

    const response = await request(createApp()).put(`${PATH}/${String(spots[0]?._id)}`)
      .set('Authorization', bearer(token)).send({ label: 'Renamed' });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(await getParkingSpots(user._id)).toStrictEqual(spots);
  });

  // Mocked behavior: the account is deleted between the session check and the edit
  // Input: a valid session, the id of the user's spot, and { label: "Renamed" }
  // Expected status code: 401
  // Expected behavior: request is rejected
  // Expected output: { error: "Unauthorized" }
  test('Account deleted while editing', async () => {
    const { user, token } = await createSignedInUser();
    const [spot] = await addParkingSpots(user._id, 1);
    jest.spyOn(UserModel, 'findOneAndUpdate').mockReturnValueOnce(resolvingQuery(null));
    failNextUserLookupAfterSessionCheck(resolvingQuery(null));

    const response = await request(createApp()).put(`${PATH}/${String(spot?._id)}`)
      .set('Authorization', bearer(token)).send({ label: 'Renamed' });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Unauthorized' });
  });

  // Mocked behavior: the edit matches the spot, but another request deletes it before the result is read
  // Input: a valid session, the id of the user's spot, and { label: "Renamed" }
  // Expected status code: 404
  // Expected behavior: the app is told the spot is gone
  // Expected output: { error: "Parking spot not found" }
  test('Spot deleted while editing', async () => {
    const { user, token } = await createSignedInUser();
    const [spot] = await addParkingSpots(user._id, 1);
    jest.spyOn(UserModel, 'findOneAndUpdate').mockReturnValueOnce(resolvingQuery({ ...user, parkingSpots: [] }));

    const response = await request(createApp()).put(`${PATH}/${String(spot?._id)}`)
      .set('Authorization', bearer(token)).send({ label: 'Renamed' });

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Parking spot not found' });
  });
});

// Interface DELETE /api/users/me/parking-spots/:id
describe('Mocked: DELETE /api/users/me/parking-spots/:id', () => {
  // Mocked behavior: deleting the spot fails
  // Input: a valid session and the id of the user's spot
  // Expected status code: 500
  // Expected behavior: error is handled without crashing, and the spot is kept
  // Expected output: { error: "Internal Server Error" }
  test('Database error while deleting', async () => {
    const { user, token } = await createSignedInUser();
    const spots = await addParkingSpots(user._id, 1);
    const remove = jest.spyOn(UserModel, 'updateOne').mockRejectedValueOnce(new Error('Simulated database error'));

    const response = await request(createApp()).delete(`${PATH}/${String(spots[0]?._id)}`)
      .set('Authorization', bearer(token));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await getParkingSpots(user._id)).toStrictEqual(spots);
  });
});
