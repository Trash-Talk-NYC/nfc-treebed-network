// What "this bed needs care" can be about.
//
// The four the captain settled on (design-record.md, constraint 9), in the
// order the approved screens lay them out: thirsty plants, litter, guard
// damage, something else. Presented as quadrants rather than a stack, one flat
// spot ink each.
//
// The ink is named as a THEME ROLE, not a hex value, for the same reason the
// rest of the presentation is (presentation.ts): a group of beds with its own
// look changes the role's value, and these tiles follow without being touched.
//
// `other` is the only one that opens the free-text box. That is a property of
// the category rather than a branch in the screen, so the screen cannot forget
// one of them.

import type { Phrase } from './i18n';
import type { ThemeColors } from './presentation';

export type ProblemCategory = 'thirsty' | 'litter' | 'guard' | 'other';

export interface Problem {
  value: ProblemCategory;
  label: Phrase;
  /** Which theme role prints this tile. */
  ink: keyof ThemeColors;
  /** The tile's border, where it differs from the ink. */
  edge: keyof ThemeColors;
  /** Whether choosing it asks for a sentence as well. */
  wantsNote: boolean;
}

export const PROBLEMS: readonly Problem[] = [
  {
    value: 'thirsty',
    label: { en: 'Thirsty plants', es: 'Plantas sedientas' },
    ink: 'action',
    edge: 'action',
    wantsNote: false,
  },
  {
    value: 'litter',
    label: { en: 'Litter', es: 'Basura' },
    ink: 'alertInk',
    edge: 'alertEdge',
    wantsNote: false,
  },
  {
    value: 'guard',
    label: { en: 'Guard damage', es: 'Protector dañado' },
    ink: 'ink',
    edge: 'ink',
    wantsNote: false,
  },
  {
    value: 'other',
    label: { en: 'Something else', es: 'Otra cosa' },
    ink: 'clear',
    edge: 'clear',
    wantsNote: true,
  },
];

/**
 * How long a free-text note may be. The approved screen counts to 300 and the
 * copy asks for a sentence; the server is what enforces it, because anything
 * in the browser is editable in devtools (spec §7).
 */
export const MAX_NOTE_CHARS = 300;

export function problemFor(value: ProblemCategory): Problem {
  const found = PROBLEMS.find((p) => p.value === value);
  // Exhaustive by the type, so this only fires if a category is added to the
  // union without a tile — which is exactly when a screen must not render.
  if (!found) throw new Error(`No problem tile for category ${value}`);
  return found;
}

/**
 * The category a submitted value names, or null if it names none.
 *
 * Strict, like `severityFrom`: an absent field must not resolve to the first
 * tile. Whoever comes to look reads this, and a category nobody picked sends
 * them for the wrong thing.
 */
export function problemFrom(raw: unknown): ProblemCategory | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return PROBLEMS.some((p) => p.value === trimmed) ? (trimmed as ProblemCategory) : null;
}

/**
 * A submitted note, trimmed and capped.
 *
 * Only `other` carries one; anything else arriving with a note keeps it,
 * because a visitor who typed a sentence and then changed tile has still said
 * something worth passing on.
 */
export function noteFrom(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_NOTE_CHARS);
}
