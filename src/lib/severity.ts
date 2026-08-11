import type { Severity } from './types';

// Severity copy, verbatim from the approved prototype's SEV array.
// Anchored to countable things so "severe" means the same from a tourist
// and a lifelong resident (spec §5).
export const SEVERITIES: ReadonlyArray<{ value: Severity; name: string; def: string }> = [
  { value: 'light', name: 'LIGHT', def: 'A few pieces. You could clear it bare-handed.' },
  { value: 'heavy', name: 'HEAVY', def: "A full trash bag's worth. Gloves and a grabber." },
  { value: 'dumping', name: 'DUMPING', def: 'Furniture, tires, or construction debris.' },
];

export function severityName(value: Severity): string {
  return SEVERITIES.find((s) => s.value === value)?.name ?? value.toUpperCase();
}

export function severityFromIndex(index: number): Severity | null {
  return SEVERITIES[index]?.value ?? null;
}
