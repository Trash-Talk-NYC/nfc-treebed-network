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
// Usage (dry run prints what would change and writes nothing):
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/rewrite-species-casing.mjs
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/rewrite-species-casing.mjs --commit

import { pathToFileURL } from 'node:url';
import { spanishSpeciesFor } from '../src/lib/tree-species.ts';

const STORE_NAME = 'treebed';
const REVISION_PREFIX = 'rev/';
const HEAD_KEY = 'head';
const MAX_COMMIT_ATTEMPTS = 5;

/**
 * The corrected Spanish species name for a bed, or null when there is
 * nothing safe to correct.
 *
 * @param {{ en: string, es: string } | undefined} treeType
 * @returns {string | null}
 */
export function correctedSpeciesCasing(treeType) {
  const expected = spanishSpeciesFor(treeType?.en ?? '');
  if (expected === null) return null;
  const stored = treeType?.es ?? '';
  if (stored === expected) return null;
  return stored.toLowerCase() === expected.toLowerCase() ? expected : null;
}

/**
 * A copy of the dataset with the fixable `treeType.es` values corrected, and
 * the list of what changed. The input is never mutated.
 *
 * @template {import('../src/lib/store-dataset.ts').Data} T
 * @param {T} data
 * @returns {{ data: T, changes: Array<{ plate: string, from: string, to: string }> }}
 */
export function rewriteSpeciesCasing(data) {
  const next = structuredClone(data);
  const changes = [];
  for (const [plate, bed] of Object.entries(next.beds ?? {})) {
    const corrected = correctedSpeciesCasing(bed.treeType);
    if (corrected === null) continue;
    changes.push({ plate, from: bed.treeType.es, to: corrected });
    bed.treeType = { ...bed.treeType, es: corrected };
  }
  return { data: next, changes };
}

const revisionKey = (revision) => `${REVISION_PREFIX}${revision}`;

/** The newest revision in the chain, and the raw dataset it holds. */
async function readNewest(blobs) {
  const raw = await blobs.get(HEAD_KEY, { type: 'text' });
  const head = Number(raw);
  let revision = Number.isInteger(head) && head > 0 ? head : await newestListed(blobs);
  let data = await blobs.get(revisionKey(revision), { type: 'json' });
  if (data === null) throw new Error(`No dataset at ${revisionKey(revision)} — nothing to rewrite.`);
  // The pointer is a lower bound; forward gets are what say where the chain ends.
  for (;;) {
    const next = await blobs.get(revisionKey(revision + 1), { type: 'json' });
    if (next === null) return { data, revision };
    revision += 1;
    data = next;
  }
}

async function newestListed(blobs) {
  const { blobs: keys } = await blobs.list({ prefix: REVISION_PREFIX });
  let newest = 0;
  for (const { key } of keys) {
    const revision = Number(key.slice(REVISION_PREFIX.length));
    if (Number.isInteger(revision) && revision > newest) newest = revision;
  }
  if (newest === 0) throw new Error('No revisions in the store — nothing to rewrite.');
  return newest;
}

/**
 * Read the newest revision, rewrite what is safe to rewrite, and (with
 * `commit`) append the result as the next revision. Returns what changed.
 *
 * @param {import('@netlify/blobs').Store} blobs
 * @param {{ commit?: boolean, log?: (line: string) => void }} [options]
 */
export async function rewriteStoredSpeciesCasing(blobs, options = {}) {
  const { commit = false, log = () => {} } = options;
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
    const { data, revision } = await readNewest(blobs);
    const { data: rewritten, changes } = rewriteSpeciesCasing(data);
    if (changes.length === 0) {
      log(`rev/${revision}: every Spanish species name is already correct — nothing to do.`);
      return { changes, revision, committed: null };
    }
    for (const { plate, from, to } of changes) log(`${plate}: "${from}" → "${to}"`);
    if (!commit) {
      log(`\nDry run. Re-run with --commit to append rev/${revision + 1}.`);
      return { changes, revision, committed: null };
    }
    const write = await blobs.set(revisionKey(revision + 1), JSON.stringify(rewritten), {
      onlyIfNew: true,
    });
    if (write.modified) {
      await blobs.set(HEAD_KEY, String(revision + 1));
      log(`\nCommitted rev/${revision + 1} (${changes.length} bed(s) rewritten).`);
      return { changes, revision, committed: revision + 1 };
    }
    log(`rev/${revision + 1} was taken by a concurrent commit — re-reading.`);
  }
  throw new Error(`Lost ${MAX_COMMIT_ATTEMPTS} commits in a row — nothing was written.`);
}

async function main() {
  const { getStore } = await import('@netlify/blobs');
  const blobs = getStore({ name: STORE_NAME, consistency: 'strong' });
  await rewriteStoredSpeciesCasing(blobs, {
    commit: process.argv.includes('--commit'),
    log: (line) => console.log(line),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
