/**
 * Fetches TransLink's GTFS Realtime feeds (#87): trip updates and service alerts.
 *
 * @remarks
 * TransLink puts the API key in the URL's query string, so every URL and error message this logs goes through
 * {@link redactKey} first. Nothing here returns the key, the URL or TransLink's response body to a caller.
 */
import { env } from '../config/env';
import { decodeFeed, FeedDecodeError, type Feed } from './gtfs-rt-decoder';
import { reserveTranslinkRequest } from './translink-quota';

/** The two feeds LiveUpdates reads. Vehicle positions aren't used. */
export type FeedKind = 'tripUpdates' | 'alerts';

const FEED_URLS: Record<FeedKind, string> = {
  tripUpdates: 'https://gtfsapi.translink.ca/v3/gtfsrealtime',
  alerts: 'https://gtfsapi.translink.ca/v3/gtfsalerts',
};
const FETCH_TIMEOUT_MS = 10_000;
const TOO_MANY_REQUESTS = 429;
const FORBIDDEN = 403; // TransLink's answer to a key that's over its limit or revoked
const MAX_FEED_BYTES = 20 * 1024 * 1024; // the real feeds are about 150 KB, so anything near this isn't one

/** Why a feed couldn't be used, or `ok`. */
export type FeedStatus =
  | 'ok'
  | 'unconfigured' // no TRANSLINK_API_KEY
  | 'capped' // today's DAILY_REQUEST_CAP is used up
  | 'rate-limited' // TransLink said 429 or 403
  | 'failed' // network error, timeout, or another HTTP error
  | 'undecodable'; // the body isn't a GTFS-RT feed

/** One attempt to fetch a feed. */
export type FeedFetchResult =
  | { status: 'ok'; feed: Feed }
  | { status: Exclude<FeedStatus, 'ok'>; retryAfterSeconds?: number };

/**
 * Removes the API key from text that might contain it: an `apikey` query parameter, and the key itself.
 *
 * @param text - A URL or error message.
 * @param key - The key, if one is configured.
 * @returns The text with `apikey=…` replaced by `apikey=REDACTED`, and any other copy of the key removed.
 */
export function redactKey(text: string, key: string | null = env.translinkApiKey): string {
  let redacted = text.replace(/([?&]apikey=)[^&#\s]*/gi, '$1REDACTED');
  if (key !== null && key !== '') redacted = redacted.split(key).join('REDACTED');
  return redacted;
}

/** A Retry-After header in seconds, when it's a number. */
function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** The message of an error and its causes (undici's `fetch failed` hides the reason in `cause`). */
function describeError(err: unknown): string {
  const parts: string[] = [];
  for (let current: unknown = err; current instanceof Error && parts.length < 3; current = current.cause) {
    parts.push(`${current.name}: ${current.message}`);
  }
  return parts.length === 0 ? String(err) : parts.join(' <- ');
}

/**
 * Fetches and decodes one of TransLink's feeds, counting it against today's cap.
 *
 * @param kind - Which feed.
 * @param now - When the request is sent, for the daily cap.
 * @returns The decoded feed, or why there isn't one. Failures are logged with the key removed.
 * @throws If the quota can't be read from the database.
 */
export async function fetchTranslinkFeed(kind: FeedKind, now: Date): Promise<FeedFetchResult> {
  const key = env.translinkApiKey;
  if (key === null) return { status: 'unconfigured' };
  if (!(await reserveTranslinkRequest(now))) return { status: 'capped' };

  const url = `${FEED_URLS[kind]}?apikey=${encodeURIComponent(key)}`;
  const logUrl = redactKey(url, key);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/x-protobuf' } });
  } catch (err) {
    console.warn(`TransLink ${kind} request failed (GET ${logUrl}): ${redactKey(describeError(err), key)}`);
    return { status: 'failed' };
  }

  if (response.status === TOO_MANY_REQUESTS || response.status === FORBIDDEN) {
    await response.body?.cancel();
    console.warn(`TransLink ${kind} request refused (GET ${logUrl}): HTTP ${response.status}`);
    const seconds = retryAfter(response);
    return seconds === undefined ? { status: 'rate-limited' } : { status: 'rate-limited', retryAfterSeconds: seconds };
  }
  if (!response.ok) {
    await response.body?.cancel();
    console.warn(`TransLink ${kind} request failed (GET ${logUrl}): HTTP ${response.status}`);
    return { status: 'failed' };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (err) {
    console.warn(`TransLink ${kind} download failed (GET ${logUrl}): ${redactKey(describeError(err), key)}`);
    return { status: 'failed' };
  }
  if (bytes.length > MAX_FEED_BYTES) {
    console.warn(`TransLink ${kind} feed is ${bytes.length} bytes (GET ${logUrl}), too big to be a feed`);
    return { status: 'undecodable' };
  }
  try {
    return { status: 'ok', feed: decodeFeed(bytes) };
  } catch (err) {
    if (!(err instanceof FeedDecodeError)) throw err;
    console.warn(`TransLink ${kind} feed isn't valid GTFS-RT (GET ${logUrl}): ${err.message}`);
    return { status: 'undecodable' };
  }
}
