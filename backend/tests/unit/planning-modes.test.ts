import { DEFAULT_PLANNING_MODES, PLANNING_MODES, UserModel } from '../../src/models/user.model';
import { TRIP_MODES } from '../../src/models/trip.model';

describe('bicycle planning mode compatibility', () => {
  test('allows bicycle alongside existing planning and trip leg modes', () => {
    expect(PLANNING_MODES).toEqual(['DRIVE', 'TRANSIT', 'BICYCLE']);
    expect(TRIP_MODES).toEqual(['DRIVE', 'TRANSIT', 'BICYCLE', 'WALK']);
  });

  test('includes bicycle in new-user planning defaults', () => {
    expect(DEFAULT_PLANNING_MODES).toEqual(['DRIVE', 'TRANSIT', 'BICYCLE']);
    expect(new UserModel({ googleId: 'test', email: 'test@example.com', name: 'Test' }).defaultModes)
      .toEqual(['DRIVE', 'TRANSIT', 'BICYCLE']);
  });
});
