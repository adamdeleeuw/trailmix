/** Narrows an unknown value to a plain object whose fields can be read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks that a value is a number in a range with at most one decimal, like the
 * app's digits-only inputs allow.
 *
 * @param value - The untrusted value.
 * @param min - The smallest allowed number.
 * @param max - The largest allowed number.
 */
export function isOneDecimalInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && value >= min && value <= max && Number(value.toFixed(1)) === value;
}
