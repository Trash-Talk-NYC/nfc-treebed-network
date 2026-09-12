/**
 * The Blobs store's name and key layout, in one place.
 *
 * It is its own module, and deliberately imports nothing: the forward-revision
 * remediation scripts in `scripts/` are plain `.mjs` run by bare `node`, which
 * resolves a `.ts` import only when every import below it names its file
 * extension too. `store-blobs.ts` does not, so a script that reached for these
 * through it would not load at all — and a script holding its own copies would
 * quietly read and write the wrong keys the day the layout changes.
 */

export const STORE_NAME = 'treebed';

export const REVISION_PREFIX = 'rev/';

// Points at a recently committed revision. A hint, not a source of truth:
// two instances committing at once can land their pointer writes in either
// order, so it is only ever a place to start walking forward from.
export const HEAD_KEY = 'head';
