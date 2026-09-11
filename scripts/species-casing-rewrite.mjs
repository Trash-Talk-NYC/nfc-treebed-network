// The rewrite rule behind `rewrite-species-casing.mjs`, in its own module so
// the entry script can check the Node version before anything imports a `.ts`
// file — the import itself is what fails on Node < 22.18, and it fails with
// ERR_UNKNOWN_FILE_EXTENSION rather than a sentence. Read that script first:
// it carries the whole rationale for this remediation.

import { tableSpeciesCasingFor } from '../src/lib/tree-species.ts';
import { HEAD_KEY, REVISION_PREFIX } from '../src/lib/store-keys.ts';

const MAX_COMMIT_ATTEMPTS = 5;

/**
 * The corrected Spanish species name for a bed, or null when there is
 * nothing safe to correct. The safety rule is `tableSpeciesCasingFor`, the
 * same predicate the admin add-bed write path applies to a typed name.
 *
 * @param {{ en: string, es: string } | undefined} treeType
 * @returns {string | null}
 */
export function correctedSpeciesCasing(treeType) {
  const stored = treeType?.es ?? '';
  const expected = tableSpeciesCasingFor(treeType?.en ?? '', stored);
  return expected === null || expected === stored ? null : expected;
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
