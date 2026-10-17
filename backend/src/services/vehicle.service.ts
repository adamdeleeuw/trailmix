import vehicles from '../data/vehicles.json';

/** Sorts names alphabetically, ignoring capitals. */
const byName = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base' });

// loaded once at startup, the file is hand-picked so it's sorted here instead of trusting its order
const modelsByMake = new Map<string, string[]>(
  Object.entries(vehicles)
    .sort(([a], [b]) => byName(a, b))
    .map(([make, models]) => [make, [...models].sort(byName)]),
);

/** Returns every car make, sorted alphabetically. */
export function listMakes(): string[] {
  return [...modelsByMake.keys()];
}

/**
 * Returns the base models for one make, sorted alphabetically.
 *
 * @param make - The make, exactly as `listMakes` returns it.
 * @returns The models, or `undefined` if the make isn't in the list.
 */
export function listModels(make: string): string[] | undefined {
  return modelsByMake.get(make);
}

/** Checks that a model is in the list for its make. */
export function isKnownVehicle(make: string, model: string): boolean {
  return listModels(make)?.includes(model) ?? false;
}
