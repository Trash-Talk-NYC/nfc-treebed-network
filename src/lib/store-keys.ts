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

// Stored care photos, one blob per photo (`photo/<id>`), OUTSIDE the revision
// chain: the dataset is re-serialized whole on every commit and a photo is
// megabytes, so the bytes live beside the chain and the dataset holds only
// the metadata row (`ReportPhoto`). The prefix is what keeps them clear of
// the pruning sweep, which lists `rev/` alone.
export const PHOTO_PREFIX = 'photo/';
