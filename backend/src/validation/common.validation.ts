/** Narrows an unknown value to a plain object whose fields can be read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks that a value is one of a fixed list, without trusting its type. */
export function isOneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

/** Checks that a value is a finite number from -limit to limit, like a latitude or longitude. */
export function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
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
