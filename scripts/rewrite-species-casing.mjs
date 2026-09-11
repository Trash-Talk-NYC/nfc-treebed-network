// One-off remediation: lowercase the Spanish species names a store was
// seeded with before the casing rule existed.
//
// `Bed.treeType.es` is stored in the casing the door frame needs — "El
// cantero de este roble sauce…", mid-sentence, so lowercase. The pilot store
// was seeded with the old capitalized values ("Roble sauce"), and seeding
// only ever runs on first contact: `ensureCheckedInBlocks` inserts by key and
// `normalizeData` is additive by decision, so nothing on the read path will
// ever correct a field a stored record already has. A human runs this
// instead, deliberately, against a store that needs it.
//
// It follows the pinHash rotation's shape (AGENTS.md, seed data): append a
// forward revision copying the newest one with only the target field
// changed. Nothing is wiped, no key is deleted, and no revision is pruned.
// It goes past `BlobsStore` rather than through it for the same reason: a
// transaction would write back a normalized dataset, and this may change
// exactly one field of exactly one record type.
//
// Safety, in the rewrite rule itself: a bed's `es` is replaced only when the
// species table knows its English name AND the stored value is that table
// value modulo casing. Anything else is a value a human typed and is left
// byte-for-byte — including a species the table does not know. That also
// makes a second run a no-op, so re-running it is free.
//
// Requires Node >= 22.18: this is a plain `.mjs` that imports `.ts` modules
// directly, which only resolves where type stripping is on without a flag.
// The repo's `engines` floor is 22, so the check below says that in a
// sentence rather than letting it surface as ERR_UNKNOWN_FILE_EXTENSION.
//
// Usage (dry run prints what would change and writes nothing):
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/rewrite-species-casing.mjs
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/rewrite-species-casing.mjs --commit
//
// Both variables are required: `@netlify/blobs` reads credentials from
// `NETLIFY_BLOBS_CONTEXT` or from an explicit siteID+token, never from the
// environment names above, so they are passed through by hand below. A
// missing one exits non-zero rather than letting the run look like a no-op.

// This file imports no `.ts` module statically, and must not start: the
// version check below has to run before such an import is attempted, and a
// static one is hoisted above every statement here.
const MIN_NODE_VERSION = [22, 18];

/** Refuses, with a sentence, on a Node too old to load the `.ts` imports. */
function requireSupportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const [minMajor, minMinor] = MIN_NODE_VERSION;
  if (major > minMajor || (major === minMajor && minor >= minMinor)) return;
  throw new Error(
    `Node ${process.versions.node} is too old: this script imports TypeScript ` +
      `modules directly, which needs unflagged type stripping (Node >= ` +
      `${minMajor}.${minMinor}).`,
  );
}

/** The Blobs credentials, or a refusal naming both variables. */
function requireCredentials(storeName) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) return { siteID, token };
  const missing = [siteID ? null : 'NETLIFY_SITE_ID', token ? null : 'NETLIFY_AUTH_TOKEN'].filter(
    Boolean,
  );
  throw new Error(
    `Missing ${missing.join(' and ')}. This script was about to read the ` +
      `"${storeName}" Blobs store and append a revision correcting Spanish ` +
      `species-name casing; both NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are ` +
      `required to reach it.`,
  );
}

async function main() {
  requireSupportedNode();
  const [{ getStore }, { STORE_NAME }, { rewriteStoredSpeciesCasing }] = await Promise.all([
    import('@netlify/blobs'),
    import('../src/lib/store-keys.ts'),
    import('./species-casing-rewrite.mjs'),
  ]);
  const { siteID, token } = requireCredentials(STORE_NAME);
  const blobs = getStore({ name: STORE_NAME, consistency: 'strong', siteID, token });
  await rewriteStoredSpeciesCasing(blobs, {
    commit: process.argv.includes('--commit'),
    log: (line) => console.log(line),
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
