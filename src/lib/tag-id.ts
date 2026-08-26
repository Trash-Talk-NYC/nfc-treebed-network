// The opaque tag ID printed inside every tag URL: /t/<id>.
//
// The ID carries no meaning at all — not the site type, not the neighbourhood,
// nothing (map decision: the tag URL is a one-way door, and tags are
// bulk-encoded before anyone knows which bed they land on). Everything a tag
// resolves to is looked up server-side through tag-bindings.ts.
//
// Format, decided on the wayfinder map (issue #5): 8 characters of Crockford
// base32, lowercase. The alphabet drops i, l, o and u so the lookalikes people
// mistype from a sign decode to the right tag instead of a dead one — i and l
// read as 1, o reads as 0, and u is out entirely (Crockford drops it to keep
// accidental words out of random IDs; there is nothing it could be mistaken
// for, so it has no mapping and a typed u is simply not a tag ID).

export const TAG_ID_LENGTH = 8;

/** Crockford base32: 0-9 plus a-z without i, l, o, u. */
export const TAG_ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** What a hand-typed lookalike was meant to be. */
const LOOKALIKES: Record<string, string> = { i: '1', l: '1', o: '0' };

const VALID = new Set(TAG_ID_ALPHABET);

/**
 * The canonical tag ID a typed or scanned string names, or null if it names
 * none. Forgiving on exactly the ways a sign gets mistyped — case, hyphens
 * and spaces someone added for legibility, and the 1/l/i and 0/o lookalikes —
 * and strict on everything else: a string that isn't 8 alphabet characters
 * after that is not a tag ID, not a near-miss to guess at.
 */
export function normalizeTagId(raw: string): string | null {
  const compact = raw.toLowerCase().replace(/[-\s]/g, '');
  if (compact.length !== TAG_ID_LENGTH) return null;
  let id = '';
  for (const char of compact) {
    const mapped = LOOKALIKES[char] ?? char;
    if (!VALID.has(mapped)) return null;
    id += mapped;
  }
  return id;
}

/** Whether `id` is already in canonical form — what the bindings registry stores. */
export function isCanonicalTagId(id: string): boolean {
  return normalizeTagId(id) === id;
}
