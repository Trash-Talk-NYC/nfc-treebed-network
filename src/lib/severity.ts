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

/**
 * The tier index a submitted value names, or null if it names none.
 *
 * Strict on purpose: `Number(null)` and `Number('')` are both 0, so a missing
 * or empty field run through `Number` would quietly mean LIGHT — a severity
 * nobody picked, on the one field the crews' queue is ordered by.
 */
export function severityIndexFrom(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const index = Number(trimmed);
  return severityFromIndex(index) === null ? null : index;
}

/** The tier a submitted value names, or null if it names none. */
export function severityFrom(raw: unknown): Severity | null {
  const index = severityIndexFrom(raw);
  return index === null ? null : severityFromIndex(index);
}
