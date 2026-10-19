import { MAX_CENTS_PER_LITRE, MIN_CENTS_PER_LITRE } from '../models/user.model';
import { isOneDecimalInRange, isRecord } from './common.validation';

/**
 * Checks the gas price the app sends.
 *
 * @remarks
 * The body is `{ centsPerLitre }`, a number from 50.0 to 400.0 with at most one
 * decimal, like the app's input allows. Anything else in the body is ignored.
 *
 * @param body - The raw request body.
 * @returns The price in cents per litre, or `undefined` if it's missing or invalid.
 */
export function parseGasPrice(body: unknown): number | undefined {
  if (!isRecord(body)) return undefined;
  const { centsPerLitre } = body;
  return isOneDecimalInRange(centsPerLitre, MIN_CENTS_PER_LITRE, MAX_CENTS_PER_LITRE) ? centsPerLitre : undefined;
}
