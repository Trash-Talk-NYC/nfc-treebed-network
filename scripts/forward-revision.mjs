// The forward-revision procedure every live-store remediation script runs, in
// one place. AGENTS.md's rule for changing a stored value is: append a
// revision copying the newest one with the value replaced — nothing wiped, no
// key deleted, and a lost race re-reads rather than overwrites. Four scripts
// need exactly that (`rewrite-species-casing`, `seed-captain-facts`,
// `carry-steward`, `retire-orphan-run-beds`), and the store-walk semantics
// they depend on — the head pointer as a LOWER BOUND, forward `get`s deciding
// where the chain actually ends, `onlyIfNew` deciding who won — are the ones
// AGENTS.md warns must not drift between readers. Defined once, they cannot.
//
// Extension-named imports only: these scripts are loaded by bare node.

import { HEAD_KEY, REVISION_PREFIX } from '../src/lib/store-keys.ts';

const MAX_COMMIT_ATTEMPTS = 5;

export const revisionKey = (revision) => `${REVISION_PREFIX}${revision}`;

async function newestListed(blobs, subject) {
  const { blobs: keys } = await blobs.list({ prefix: REVISION_PREFIX });
  let newest = 0;
  for (const { key } of keys) {
    const revision = Number(key.slice(REVISION_PREFIX.length));
    if (Number.isInteger(revision) && revision > newest) newest = revision;
  }
  if (newest === 0) throw new Error(`No revisions in the store — nothing to ${subject}.`);
  return newest;
}

/**
 * The newest revision in the chain, and the raw dataset it holds.
 *
 * The head pointer is a lower bound — a racing commit may have moved it back a
 * revision, and a listing is only eventually consistent — so the walk forward
 * is what says where the chain ends: a revision that exists is one `get` must
 * return.
 *
 * @param {import('@netlify/blobs').Store} blobs
 * @param {string} subject the verb for the refusal sentence ('fill', 'carry'…)
 */
export async function readNewest(blobs, subject = 'change') {
  const raw = await blobs.get(HEAD_KEY, { type: 'text' });
  const head = Number(raw);
  let revision = Number.isInteger(head) && head > 0 ? head : await newestListed(blobs, subject);
  let data = await blobs.get(revisionKey(revision), { type: 'json' });
  if (data === null) {
    throw new Error(`No dataset at ${revisionKey(revision)} — nothing to ${subject}.`);
  }
  for (;;) {
    const next = await blobs.get(revisionKey(revision + 1), { type: 'json' });
    if (next === null) return { data, revision };
    revision += 1;
    data = next;
  }
}

/**
 * Read the newest revision, hand it to `apply`, and (with `commit`) append
 * what comes back as the next revision. A lost commit re-runs `apply` against
 * the dataset that beat it, so a decision is never made against a revision
 * somebody else has replaced.
 *
 * `apply(data, revision)` returns `{ data, result, skip }`: the dataset to
 * commit, whatever the caller wants back, and `skip: true` for "there is
 * nothing to write" — which returns without committing, because a revision
 * that changes nothing still costs a whole-dataset upload. It may log; it is
 * called once per attempt.
 *
 * @template R what `apply` hands back, returned to the caller untouched.
 * @param {import('@netlify/blobs').Store} blobs
 * @param {(data: any, revision: number) => { data: any, result: R, skip?: boolean }
 *   | Promise<{ data: any, result: R, skip?: boolean }>} apply
 * @param {{
 *   commit?: boolean,
 *   log?: (line: string) => void,
 *   subject?: string,
 *   committedLine?: (revision: number, result: R) => string,
 * }} [options]
 * @returns {Promise<{ result: R, revision: number, committed: number | null }>}
 */
export async function commitForwardRevision(blobs, apply, options = {}) {
  const {
    commit = false,
    log = () => {},
    subject = 'change',
    committedLine = (revision) => `Committed rev/${revision}.`,
  } = options;
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
    const { data, revision } = await readNewest(blobs, subject);
    const { data: next, result, skip = false } = await apply(data, revision);
    if (skip) return { result, revision, committed: null };
    if (!commit) {
      log(`\nDry run. Re-run with --commit to append rev/${revision + 1}.`);
      return { result, revision, committed: null };
    }
    const write = await blobs.set(revisionKey(revision + 1), JSON.stringify(next), {
      onlyIfNew: true,
    });
    if (write.modified) {
      await blobs.set(HEAD_KEY, String(revision + 1));
      log(`\n${committedLine(revision + 1, result)}`);
      return { result, revision, committed: revision + 1 };
    }
    log(`rev/${revision + 1} was taken by a concurrent commit — re-reading.`);
  }
  throw new Error(`Lost ${MAX_COMMIT_ATTEMPTS} commits in a row — nothing was written.`);
}
