// What every typed field goes through before it is stored or rendered.
//
// One place, because both the admin's fields (service.ts) and the visitor's
// care note (problem.ts) land on a screen as a leaf beside copy of ours, and
// a field that skips this is a field a hand-built POST can scramble.

/**
 * The bidirectional-format overrides, which a hand-built POST can carry into a
 * field the browser's own input would never produce. Every typed field lands
 * on a screen as a leaf beside copy of ours, and a U+202E can visually
 * scramble the text around it. They are zero-width, so they are dropped.
 */
const BIDI_FORMAT_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/**
 * Control characters and whitespace runs. A textarea submits Enter as CRLF and
 * a note is one line on the screen it lands on, so a break between two words
 * must stay a gap between them rather than glue them together — which is why
 * these become a single space instead of vanishing like the overrides above.
 */
const WHITESPACE_RUN_RE = /[\p{Cc}\s]+/gu;

/** Strip what cannot be rendered, collapse whitespace, trim, then bound. */
export function capped(raw: string, max: number): string {
  return raw.replace(BIDI_FORMAT_RE, '').replace(WHITESPACE_RUN_RE, ' ').trim().slice(0, max);
}
