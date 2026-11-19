/**
 * Encrypts user data before it reaches MongoDB, and hashes the values lookups need (#89).
 *
 * @remarks
 * One 256-bit data key yields two keys through HKDF: one for AES-256-GCM, one for HMAC-SHA256 lookup hashes. In
 * production the key exists only wrapped by Cloud KMS (`DATA_KEY_WRAPPED`) and is unwrapped once at startup, so a
 * copy of the database, a backup or `backend/.env` holds no usable key. Dev and the tests use a local `DATA_KEY`.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

/** An encrypted value as stored in MongoDB. */
export interface Sealed {
  v: number; // key version, so the key can be rotated later
  iv: string; // base64, fresh and random for every value
  data: string; // base64 ciphertext of the value's JSON
  tag: string; // base64 GCM authentication tag
}

const KEY_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CIPHER = 'aes-256-gcm';
const KMS_KEY = 'projects/cpen321-m1-508304/locations/us-west1/keyRings/trailmix/cryptoKeys/user-data';
const KMS_SCOPE = 'https://www.googleapis.com/auth/cloudkms';
const DATE_TAG = '$date'; // marks a Date inside a sealed value's JSON, so it reads back as a Date
const SEALED_KEYS = ['data', 'iv', 'tag', 'v'];

let keys: { encryption: Buffer; lookup: Buffer } | undefined;

function deriveKeys(dataKey: Buffer): { encryption: Buffer; lookup: Buffer } {
  if (dataKey.length !== KEY_BYTES) throw new Error('The data key must be 32 bytes');
  const derive = (info: string): Buffer => Buffer.from(hkdfSync('sha256', dataKey, Buffer.alloc(0), info, KEY_BYTES));
  return { encryption: derive('trailmix field encryption v1'), lookup: derive('trailmix lookup hash v1') };
}

// the dev and test key, base64 in DATA_KEY
function localKey(): Buffer {
  const value = process.env.DATA_KEY?.trim();
  if (value === undefined || value === '') throw new Error('DATA_KEY is not defined');
  return Buffer.from(value, 'base64');
}

// asks KMS, as the VM's service account, to unwrap the data key
async function unwrapWithKms(wrapped: string): Promise<Buffer> {
  const client = await new GoogleAuth({ scopes: KMS_SCOPE }).getClient();
  const response = await client.request<{ plaintext: string }>({
    url: `https://cloudkms.googleapis.com/v1/${KMS_KEY}:decrypt`,
    method: 'POST',
    data: { ciphertext: wrapped },
  });
  // KMS wrapped the key's base64 text, which survives shells and pipes when the key is made
  return Buffer.from(Buffer.from(response.data.plaintext, 'base64').toString('utf8'), 'base64');
}

/**
 * Loads the data key, once at startup.
 *
 * @remarks
 * Uses `DATA_KEY_WRAPPED` through Cloud KMS when it's set, else the local `DATA_KEY`. Production refuses to start
 * without the wrapped key, so a local key can never protect real user data.
 *
 * @throws If no key is configured, KMS refuses, or the key isn't 32 bytes.
 */
export async function loadDataKey(): Promise<void> {
  const wrapped = process.env.DATA_KEY_WRAPPED?.trim();
  if (wrapped !== undefined && wrapped !== '') {
    keys = deriveKeys(await unwrapWithKms(wrapped));
    return;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATA_KEY_WRAPPED is required in production');
  keys = deriveKeys(localKey());
}

// the loaded keys, or the local key for tests and scripts that never call loadDataKey
function currentKeys(): { encryption: Buffer; lookup: Buffer } {
  if (keys !== undefined) return keys;
  if (process.env.NODE_ENV === 'production') throw new Error('The data key was not loaded');
  keys = deriveKeys(localKey());
  return keys;
}

function encode(value: unknown): string {
  // replacer functions see a Date only through `this`, since JSON has already turned it into a string
  return JSON.stringify(value, function keepDates(this: Record<string, unknown>, key: string, json: unknown) {
    const raw = this[key];
    return raw instanceof Date ? { [DATE_TAG]: raw.toISOString() } : json;
  });
}

function decode(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    const date = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[DATE_TAG] : undefined;
    return typeof date === 'string' ? new Date(date) : value;
  });
}

/**
 * Encrypts a value for storage.
 *
 * @remarks
 * `context` is authenticated with the value, so a sealed value copied to another document or field won't open.
 *
 * @param value - Any JSON value, which may contain Dates.
 * @param context - Where the value is stored, like `users:<id>:email`.
 * @returns The sealed value.
 */
export function seal(value: unknown, context: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, currentKeys().encryption, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const data = Buffer.concat([cipher.update(encode(value), 'utf8'), cipher.final()]);
  return { v: KEY_VERSION, iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

/**
 * Decrypts a value sealed by {@link seal}.
 *
 * @param sealed - The stored value.
 * @param context - The same context it was sealed with.
 * @returns The original value.
 * @throws If the value, its tag or its context was changed, or it uses an unknown key version.
 */
export function open(sealed: Sealed, context: string): unknown {
  if (sealed.v !== KEY_VERSION) throw new Error(`Unknown key version ${sealed.v}`);
  const decipher = createDecipheriv(CIPHER, currentKeys().encryption, Buffer.from(sealed.iv, 'base64'), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return decode(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8'));
}

/** Whether a stored value is a sealed one rather than plaintext saved before encryption. */
export function isSealed(value: unknown): value is Sealed {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join() === SEALED_KEYS.join()
    && typeof record.v === 'number' && typeof record.iv === 'string'
    && typeof record.data === 'string' && typeof record.tag === 'string';
}

/**
 * Hashes a value that lookups match on, like a Google account ID, with a secret key.
 *
 * @param value - The plaintext value.
 * @returns 64 hex characters, the same for the same value, and useless without the key.
 */
export function lookupHash(value: string): string {
  return createHmac('sha256', currentKeys().lookup).update(value, 'utf8').digest('hex');
}

/**
 * Seals every field of a document except the ones that must stay readable for queries.
 *
 * @remarks
 * Each field is sealed on its own, with `<context>:<field>` as its context, so updating one field stays a single
 * atomic write. A field added to a model later is sealed automatically. Fields set to `undefined` are left out.
 *
 * @param fields - The plaintext fields.
 * @param context - The document, like `users:<id>`.
 * @param readable - The fields stored as they are.
 * @returns The fields to store.
 */
export function sealFields(
  fields: Record<string, unknown>,
  context: string,
  readable: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => [name, readable.has(name) ? value : seal(value, `${context}:${name}`)]));
}

/**
 * Opens every sealed field of a stored document.
 *
 * @remarks
 * Fields saved before encryption are still plaintext, and pass through until the migration seals them.
 *
 * @param stored - The document as MongoDB returned it.
 * @param context - The context it was sealed with.
 * @returns The plaintext fields.
 * @throws If a sealed field fails to open.
 */
export function openFields(stored: Record<string, unknown>, context: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(stored)
    .map(([name, value]) => [name, isSealed(value) ? open(value, `${context}:${name}`) : value]));
}
