// How a bed looks, read from the bed's record rather than written into the
// markup.
//
// Every bed returns the same defaults today and nothing here varies by bed.
// That is the point. The captain intends to give a GROUP of beds — a block, a
// sponsor, a partner org — its own colours, logo and headline copy later, and
// grouping is deliberately NOT being built now. What is being avoided is the
// unpicking job: a screen that writes `#eae9da` in fifty places has to be
// rewritten when the group arrives, while a screen that writes
// `var(--theme-ground)` only needs `presentationFor` to start answering
// differently.
//
// So the rule for every screen in this build is: no literal brand colour, no
// literal logo path, and no literal wordmark in the markup. They come from
// here.
//
// The palette itself is the identity the captain approved in the tap-flow
// review (data/tap-flow-decision/design-record.md, constraint 2), with the
// roles it assigns:
//   Deep Purple      the ADMIN's action colour, and nothing else. It was the
//                    positive ownership action (adopt) until the captain's
//                    2026-09-11 ground reversal put every tap-flow screen on
//                    the green: the purple is 1.36:1 there, so the visitor
//                    flow now has no action colour at all and its buttons are
//                    the beige pair — filled for the primary, outlined for
//                    the secondary, which keeps the approved hierarchy WITHIN
//                    each screen. What is gone is a colour that meant
//                    "ownership action" ACROSS screens; inventing a new adopt
//                    treatment on the green is a look change nobody asked for
//   Street Sign Yellow attention / something needs doing — ALWAYS with Roadtop
//                    Black on top, never white: yellow with white fails WCAG AA
//   Post No Bills Green  all clear, adopted, and — since the captain's
//                    2026-09-11 reversal — the solid page ground every
//                    tap-flow screen stands on, both doors and the takeovers
//   Poster Beige     the secondary: the ink and buttons on the green, the
//                    paper the containers and picker tiles stand on, and the
//                    ADMIN's page ground. On the green it is also how
//                    AFFIRMATION reads: the green ground has no ink that
//                    stands off its own beige body text, so a confirmed state
//                    (the care screen's attached photo) INVERTS the fill —
//                    beige paper with green ink, 4.59:1, the `band-clear` and
//                    `btn-on-clear` vocabulary — rather than swapping an ink
//   Roadtop Black    ink, dark surfaces
//
// Contrast, checked against WCAG AA (4.5:1 for body text, 3:1 for large text
// and UI borders):
//   black  #1d1d23 on beige   #eae9da  13.71:1
//   black  #1d1d23 on surface #fbfaf4  16.04:1
//   black  #1d1d23 on yellow  #f3cf02  10.97:1  (white on yellow is 1.53:1 —
//                                                never do it)
//   beige  #eae9da on green   #4e6e65   4.59:1
//   white  #ffffff on purple  #65409a   7.63:1
//   beige  #eae9da on purple  #65409a   6.23:1
//   muted  #5c5b52 on beige   #eae9da   5.59:1
//   faint  #6a695e on beige   #eae9da   4.52:1
//   onClearMuted #e0e8e5 on green      4.50:1
//   yellow #f3cf02 on green   #4e6e65   3.67:1  (a FILL on the green — the
//                                               band and the error chip —
//                                               which owes 3:1 as UI; the
//                                               text on it is the black)
//   purple #65409a on beige   #eae9da   6.23:1
//   green  #4e6e65 on beige   #eae9da   4.59:1
//   alertInk #7a6600 on beige #eae9da   4.60:1
//
// Three of those are one step off the review mock, and only because the mock's
// value does not clear AA for body text: its muted ink #6f6e63 (4.20:1), its
// placeholder ink #a3a294 (1.9:1), and the sub-copy over the green ground
// #cfe0da (4.1:1). A fourth, the litter tile's border #b39800, is one step
// darker for the 3:1 a border owes. Each moved the minimum distance to the
// threshold and no further, so the screens still read as the approved ones. No
// hue changed, and no off-brand tint was invented. `tests/presentation.test.ts`
// is what holds every pairing to it, so a future group theme cannot quietly
// ship an unreadable one.

import type { Bed } from './types';
import type { Phrase } from './i18n';

/** Colour roles a screen may use. Names are roles, never hues. */
export interface ThemeColors {
  /**
   * The Poster Beige role: the paper the containers and picker tiles stand
   * on, and the ADMIN's page ground. The tap flow's own page ground is
   * `clear` since the captain's 2026-09-11 reversal — the two roles kept
   * their names so the admin surface, which reads the same properties,
   * stayed untouched by that reversal.
   */
  ground: string;
  /** Ink on the page ground. */
  ink: string;
  /** Secondary ink on the page ground — labels, help text. */
  muted: string;
  /** Placeholder / disabled ink. */
  faint: string;
  /** Hairlines and field borders. */
  border: string;
  /** Raised surface (cards, fields) on the page ground. */
  surface: string;
  /**
   * The action colour — the ADMIN's, since the 2026-09-11 ground reversal.
   * The visitor flow's buttons are the beige pair on the green; see the
   * palette roles at the top of this file.
   */
  action: string;
  /** Ink on `action`. */
  onAction: string;
  /** Attention: something needs doing. */
  alert: string;
  /** Ink on `alert`. Yellow carries black, never white — AA. */
  onAlert: string;
  /**
   * The yellow darkened enough to be an ink on the page ground, and the edge
   * that goes with it. Street Sign Yellow itself is a ground, not an ink: at
   * 1.4:1 on Poster Beige it cannot carry text or draw a border anybody can
   * see. The riso tile for litter needs both, so the role is named here rather
   * than darkened by eye at the call site.
   */
  alertInk: string;
  alertEdge: string;
  /**
   * All-clear / adopted — and the solid page ground every tap-flow screen
   * stands on (the captain's 2026-09-11 reversal; see `ground` above).
   */
  clear: string;
  /** Ink on `clear`. */
  onClear: string;
  /** Secondary ink on `clear` — kickers and sub-copy over the green. */
  onClearMuted: string;
}

/** Everything a screen needs about a bed's presentation. */
export interface Presentation {
  colors: ThemeColors;
  /**
   * The bed owner's mark. Deliberately kept though no approved screen renders
   * one yet: it is half of the seam this file exists for — a sponsor's or a
   * block's own logo has to be a lookup here rather than a rewrite across
   * every screen. It and `public/img/trash-talk-nyc-logo.png` are NOT dead
   * weight; do not delete them in a cleanup.
   */
  logo: {
    src: string;
    /** Alt text is copy, so it is bilingual like the rest. */
    alt: Phrase;
    width: number;
    height: number;
  };
  /** Copy that belongs to the bed's owner rather than to the product. */
  copy: {
    /** The wordmark in the kicker. A name, so it is not translated. */
    wordmark: string;
    /** Displayed after the wordmark on the door screens, e.g. "W 171ST". */
    locality: string;
  };
}

const DEFAULT_COLORS: ThemeColors = {
  ground: '#eae9da', // Poster Beige
  ink: '#1d1d23', // Roadtop Black
  muted: '#5c5b52',
  faint: '#6a695e',
  border: '#c9c7b4',
  surface: '#fbfaf4',
  action: '#65409a', // Deep Purple
  onAction: '#ffffff',
  alert: '#f3cf02', // Street Sign Yellow
  onAlert: '#1d1d23', // never #fff — 1.53:1
  alertInk: '#7a6600', // 4.60:1 on beige
  alertEdge: '#998200', // 3.09:1 on beige — a border owes 3:1
  clear: '#4e6e65', // Post No Bills Green
  onClear: '#eae9da',
  onClearMuted: '#e0e8e5',
};

/**
 * The mark and the brand copy every bed answers with today.
 *
 * Single-sourced rather than spelled out in each lookup below: a block's or a
 * sponsor's own mark should be one literal to change here, which is the whole
 * premise of this file.
 */
const DEFAULT_LOGO: Presentation['logo'] = {
  src: '/img/trash-talk-nyc-logo.png',
  alt: { en: 'Trash Talk NYC', es: 'Trash Talk NYC' },
  width: 137,
  height: 144,
};

const DEFAULT_COPY: Presentation['copy'] = {
  wordmark: 'TRASH TALK NYC',
  locality: '',
};

/**
 * The short locality a door screen prints beside the wordmark.
 *
 * Taken off the bed's cross streets rather than typed a second time, so the two
 * cannot drift. "W 138 St × Adam Clayton Powell Jr Blvd" → "W 138 ST".
 */
function localityFrom(bed: Bed): string {
  const first = bed.crossStreets.split('×')[0] ?? bed.crossStreets;
  return first.trim().toUpperCase();
}

/**
 * The presentation for one bed.
 *
 * Every bed answers with the defaults today; a bed's group will be the lookup
 * that changes that, and this is the only function it has to change.
 */
export function presentationFor(bed: Bed): Presentation {
  return {
    colors: { ...DEFAULT_COLORS },
    logo: { ...DEFAULT_LOGO, alt: { ...DEFAULT_LOGO.alt } },
    copy: { ...DEFAULT_COPY, locality: localityFrom(bed) },
  };
}

/**
 * The presentation for a screen with no bed behind it — an unbound tag, or a
 * refusal answered before any bed was read.
 */
export function defaultPresentation(): Presentation {
  return {
    colors: { ...DEFAULT_COLORS },
    logo: { ...DEFAULT_LOGO, alt: { ...DEFAULT_LOGO.alt } },
    copy: { ...DEFAULT_COPY, locality: '' },
  };
}

/**
 * The colour roles as CSS custom properties, for the one `style` attribute a
 * screen sets on its root.
 *
 * This is the whole mechanism: the properties are written once per render from
 * the record, and every rule in the stylesheet reads them. Nothing else in the
 * build may name a colour.
 */
export function themeStyle(colors: ThemeColors): string {
  return Object.entries(colors)
    .map(([role, value]) => `--theme-${kebab(role)}:${value}`)
    .join(';');
}

/** The CSS custom property that carries one colour role. */
export function themeVar(role: keyof ThemeColors): string {
  return `var(--theme-${kebab(role)})`;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
