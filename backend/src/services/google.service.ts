import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';

/** The Google account details Trailmix keeps. */
export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  photoUrl: string | null;
}

// created lazily so a missing env var doesn't crash on import
let client: OAuth2Client | undefined;

/**
 * Verifies a Google ID token and extracts the account it belongs to.
 *
 * @remarks
 * Google's library checks the signature, expiry, issuer, and that the audience
 * is our client ID.
 *
 * @param idToken - The ID token the app received from Google sign-in.
 * @returns The account's Google ID, email, name (the email if Google gives none),
 * and photo URL.
 * @throws If the token is invalid, or it doesn't carry an email.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  client ??= new OAuth2Client(env.googleClientId);

  const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientId });
  const payload = ticket.getPayload();
  if (payload?.email === undefined) {
    throw new Error('Google token has no email');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    photoUrl: payload.picture ?? null,
  };
}
