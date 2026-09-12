// The tag ID printed inside every tag URL: /t/<id>.
//
// Two shapes share one alphabet:
//
//  - OPAQUE, 8 characters — the original format, decided on the wayfinder map
//    (issue #5): bulk-encoded tags whose site is unknowable at encoding time
//    carry an ID with no meaning at all, and everything a tag resolves to is
//    looked up server-side through tag-bindings.ts.
//  - NAMED, 11 characters — the captain's own bed-ID scheme for the W 171st /
//    Haven runs (2026-09-12): `1E170171HFW` and its siblings. These ids DO
//    carry meaning — position, run, streets — because the captain asked for
//    exactly that: "it's supposed to be the url actually and the bed id".
//
// The named scheme is a DELIBERATE OVERRIDE of the earlier "no meaning in the
// URL, ever" rule (design-record constraint 6 / map decision 3), made by the
// captain on 2026-09-12 knowing the trade it reverses: a readable id on a
// chip broadcasts which bed it is, and renaming a bed means physically
// re-encoding its tag. He wants the bed's id to BE the URL, so the id a
// neighbour reads off the guard and the id the team says out loud are the
// same string. Do not "fix" this back to opaque-only; the opaque format
// stays valid beside it for every tag already minted and any future bulk
// batch. The two 8-character runs of his scheme (`1SHFW171`, `1NHFW171`)
// are, by coincidence of alphabet, indistinguishable from opaque ids here —
// the bindings registry is what tells them apart, which is fine, because
// nothing routes on the difference.
//
// Both shapes are Crockford base32, lowercase canonical. The alphabet drops
// i, l, o and u so the lookalikes people mistype from a sign decode to the
// right tag instead of a dead one — i and l read as 1, o reads as 0, and u is
// out entirely (Crockford drops it to keep accidental words out of random
// IDs; there is nothing it could be mistaken for, so it has no mapping and a
// typed u is simply not a tag ID). The captain's ids fit that alphabet as he
// spelled them, uppercase included: `/t/1NHFW171` normalizes to the lowercase
// canonical and redirects, the same forgiveness every hand-typed id gets.

/** The opaque format's length — what freshly minted bulk ids use. */
export const TAG_ID_LENGTH = 8;

/**
 * Every length a tag ID may have: 8 for the opaque format, 11 for the
 * captain's named E-run format (`1E170171HFW`). A set rather than a range so
 * a new shape is a deliberate entry here, not a string that happens to fit.
 */
export const TAG_ID_LENGTHS: ReadonlySet<number> = new Set([8, 11]);

/** Crockford base32: 0-9 plus a-z without i, l, o, u. */
export const TAG_ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** What a hand-typed lookalike was meant to be. */
const LOOKALIKES: Record<string, string> = { i: '1', l: '1', o: '0' };

const VALID = new Set(TAG_ID_ALPHABET);

/**
 * The canonical tag ID a typed or scanned string names, or null if it names
 * none. Forgiving on exactly the ways a sign gets mistyped — case, hyphens
 * and spaces someone added for legibility, and the 1/l/i and 0/o lookalikes —
 * and strict on everything else: a string that isn't a known length of
 * alphabet characters after that is not a tag ID, not a near-miss to guess at.
 */
export function normalizeTagId(raw: string): string | null {
  const compact = raw.toLowerCase().replace(/[-\s]/g, '');
  if (!TAG_ID_LENGTHS.has(compact.length)) return null;
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
