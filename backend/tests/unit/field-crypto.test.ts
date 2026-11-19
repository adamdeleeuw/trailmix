import { GoogleAuth } from 'google-auth-library';

import { isSealed, loadDataKey, lookupHash, open, seal, sealFields, openFields, type Sealed } from '../../src/services/field-crypto';

// issue #89: every field that describes a person, a place or a trip is encrypted before it reaches MongoDB

const KMS_KEY_URL = 'https://cloudkms.googleapis.com/v1/projects/cpen321-m1-508304/locations/us-west1/keyRings/trailmix/cryptoKeys/user-data:decrypt';
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const TEST_KEY = process.env.DATA_KEY;

afterEach(async () => {
  jest.restoreAllMocks();
  delete process.env.DATA_KEY_WRAPPED;
  process.env.NODE_ENV = 'test';
  process.env.DATA_KEY = TEST_KEY;
  await loadDataKey(); // back to the test key for the next test
});

// flips one character of a base64 value, so it decodes to different bytes
function tamper(value: string): string {
  return (value.startsWith('A') ? 'B' : 'A') + value.slice(1);
}

describe('seal and open', () => {
  // Input: a nested value with strings, numbers, null, arrays and Dates
  // Expected output: the same value back, with the Dates still Dates
  test('returns the sealed value, Dates included', () => {
    const value = { label: 'Home', lat: 49.2697, rate: null, legs: [{ departAt: new Date('2026-11-19T15:30:00.000Z') }] };

    const opened = open(seal(value, 'users:1:spot'), 'users:1:spot');

    expect(opened).toStrictEqual(value);
  });

  // Input: the same value sealed twice
  // Expected output: different ciphertexts, so equal values can't be spotted in the database
  test('seals the same value differently every time', () => {
    const first = seal('ada@example.com', 'users:1:email');
    const second = seal('ada@example.com', 'users:1:email');

    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
    expect(JSON.stringify(first)).not.toContain('ada');
  });

  // Input: a value opened with another document's or field's context
  // Expected behavior: it fails, so a sealed value copied to another account or field can't be read there
  test("refuses a value moved to another document or field", () => {
    const sealed = seal('ada@example.com', 'users:1:email');

    expect(() => open(sealed, 'users:2:email')).toThrow();
    expect(() => open(sealed, 'users:1:name')).toThrow();
  });

  // Input: a sealed value with its ciphertext, tag or IV changed
  // Expected behavior: it fails rather than returning altered data
  test('refuses a changed value', () => {
    const sealed = seal('ada@example.com', 'users:1:email');

    expect(() => open({ ...sealed, data: tamper(sealed.data) }, 'users:1:email')).toThrow();
    expect(() => open({ ...sealed, tag: tamper(sealed.tag) }, 'users:1:email')).toThrow();
    expect(() => open({ ...sealed, iv: tamper(sealed.iv) }, 'users:1:email')).toThrow();
  });

  // Input: a sealed value with a key version this backend doesn't have
  // Expected behavior: it fails with the version named
  test('refuses an unknown key version', () => {
    const sealed: Sealed = { ...seal('x', 'c'), v: 2 };

    expect(() => open(sealed, 'c')).toThrow('Unknown key version 2');
  });
});

describe('isSealed', () => {
  // Input: a sealed value, and plaintext values that look a little like one
  // Expected output: true only for the sealed value
  test('tells sealed values from plaintext', () => {
    expect(isSealed(seal('x', 'c'))).toBe(true);
    expect(isSealed('x')).toBe(false);
    expect(isSealed(null)).toBe(false);
    expect(isSealed([1, 2])).toBe(false);
    expect(isSealed({ lat: 49, lng: -123 })).toBe(false);
    expect(isSealed({ v: 1, iv: 'a', data: 'b', tag: 'c', extra: true })).toBe(false);
    expect(isSealed({ v: '1', iv: 'a', data: 'b', tag: 'c' })).toBe(false);
  });
});

describe('sealFields and openFields', () => {
  // Input: a document with readable and other fields, one of them undefined
  // Expected output: only the other fields sealed, each to its own field, the undefined one left out, and the
  //                  document back unchanged after opening
  test('seals all but the readable fields, and opens them again', () => {
    const doc = { _id: 'abc', status: 'ACTIVE', origin: { label: 'Home' }, legs: [], note: undefined };

    const stored = sealFields(doc, 'trips:abc', new Set(['_id', 'status']));

    expect(stored._id).toBe('abc');
    expect(stored.status).toBe('ACTIVE');
    expect(isSealed(stored.origin)).toBe(true);
    expect(isSealed(stored.legs)).toBe(true);
    expect('note' in stored).toBe(false);
    expect(openFields(stored, 'trips:abc')).toStrictEqual({ _id: 'abc', status: 'ACTIVE', origin: { label: 'Home' }, legs: [] });
  });

  // Input: a document saved before encryption, with plaintext fields
  // Expected output: the plaintext, unchanged, so the app works until the migration has run
  test('passes plaintext saved before encryption through', () => {
    expect(openFields({ email: 'ada@example.com' }, 'users:1')).toStrictEqual({ email: 'ada@example.com' });
  });
});

describe('lookupHash', () => {
  // Input: Google account IDs
  // Expected output: 64 hex characters, the same for the same ID, different for another, never the ID itself
  test('hashes the same value the same way, without revealing it', () => {
    const hash = lookupHash('109876543210987654321');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(lookupHash('109876543210987654321')).toBe(hash);
    expect(lookupHash('109876543210987654322')).not.toBe(hash);
    expect(hash).not.toContain('1098765432');
  });
});

describe('loadDataKey', () => {
  // Input: production without DATA_KEY_WRAPPED, even with a local DATA_KEY set
  // Expected behavior: startup fails, so a local key never protects real data
  test('refuses to start production without the KMS-wrapped key', async () => {
    process.env.NODE_ENV = 'production';

    await expect(loadDataKey()).rejects.toThrow('DATA_KEY_WRAPPED is required in production');
  });

  // Mocked behavior: KMS unwraps the wrapped key to another key's base64 text
  // Input: DATA_KEY_WRAPPED set
  // Expected behavior: the backend asks KMS's user-data key to decrypt it, and uses what KMS returns
  test('unwraps the data key with Cloud KMS', async () => {
    const request = jest.fn().mockResolvedValue({ data: { plaintext: Buffer.from(OTHER_KEY).toString('base64') } });
    jest.spyOn(GoogleAuth.prototype, 'getClient').mockResolvedValue({ request } as never);
    process.env.NODE_ENV = 'production';
    process.env.DATA_KEY_WRAPPED = 'wrapped-key-base64';
    const underTestKey = seal('x', 'c');

    await loadDataKey();

    expect(request).toHaveBeenCalledWith({ url: KMS_KEY_URL, method: 'POST', data: { ciphertext: 'wrapped-key-base64' } });
    expect(() => open(underTestKey, 'c')).toThrow(); // a different key is now in use
    expect(open(seal('x', 'c'), 'c')).toBe('x');
  });

  // Input: no key at all outside production
  // Expected behavior: it fails, naming the missing variable
  test('needs DATA_KEY outside production', async () => {
    delete process.env.DATA_KEY;

    await expect(loadDataKey()).rejects.toThrow('DATA_KEY is not defined');
  });

  // Input: a DATA_KEY that isn't 32 bytes
  // Expected behavior: it fails rather than encrypting with a weak key
  test('refuses a key of the wrong length', async () => {
    process.env.DATA_KEY = Buffer.alloc(16).toString('base64');

    await expect(loadDataKey()).rejects.toThrow('The data key must be 32 bytes');
  });
});

describe('before the key is loaded', () => {
  // Input: sealing in production when startup never loaded the key
  // Expected behavior: it fails instead of falling back to a local key
  test('refuses to seal in production', () => {
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'production';
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports -- a fresh copy of the module, with no key loaded
      const fresh = require('../../src/services/field-crypto') as typeof import('../../src/services/field-crypto');

      expect(() => fresh.seal('x', 'c')).toThrow('The data key was not loaded');
    });
  });
});
