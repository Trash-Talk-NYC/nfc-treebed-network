// The store side of `carry-steward.mjs`, in its own module so the entry
// script can check the Node version before anything imports a `.ts` file,
// and so tests/store-blobs.test.ts can drive this against the emulated Blobs
// server — the same wire protocol the pilot store speaks. Read the entry
// script first: it carries the whole rationale for the carry.
//
// Same forward-revision shape as species-casing-rewrite.mjs: read the newest
// revision, apply the change to a copy, append it as `rev/<n+1>` with
// `onlyIfNew` — nothing wiped, no key deleted, no revision pruned, and a
// lost race re-reads rather than overwrites.

import { CarryRefusal, carrySteward, dataCarryPort } from '../src/lib/steward-carry.ts';
import { HEAD_KEY, REVISION_PREFIX } from '../src/lib/store-keys.ts';

export { CarryRefusal };

const MAX_COMMIT_ATTEMPTS = 5;

const revisionKey = (revision) => `${REVISION_PREFIX}${revision}`;

/** The newest revision in the chain — the head pointer is a lower bound. */
async function readNewest(blobs) {
  const raw = await blobs.get(HEAD_KEY, { type: 'text' });
  const head = Number(raw);
  let revision = Number.isInteger(head) && head > 0 ? head : await newestListed(blobs);
  let data = await blobs.get(revisionKey(revision), { type: 'json' });
  if (data === null) throw new Error(`No dataset at ${revisionKey(revision)} — nothing to carry.`);
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
  if (newest === 0) throw new Error('No revisions in the store — nothing to carry.');
  return newest;
}

/**
 * The steward named on the command line: a public @username (with or without
 * the @) or a raw user id. Throws CarryRefusal ('invalid-input') on an
 * ambiguous or unknown name rather than guessing — this moves a real
 * person's adoption.
 */
export function resolveUser(data, named) {
  const users = Object.values(data.users ?? {});
  const bare = named.startsWith('@') ? named.slice(1) : named;
  const byUsername = users.filter((u) => u.username.toLowerCase() === bare.toLowerCase());
  if (byUsername.length === 1) return byUsername[0];
  if (byUsername.length > 1) {
    throw new CarryRefusal('invalid-input', `More than one user is named @${bare}.`);
  }
  const byId = data.users?.[named];
  if (byId) return byId;
  throw new CarryRefusal(
    'invalid-input',
    `No steward @${bare} (and no user id "${named}") in the store.`,
  );
}

/**
 * Read the newest revision, carry the steward on a copy, and (with `commit`)
 * append the result as the next revision.
 *
 * @param {import('@netlify/blobs').Store} blobs
 * @param {{ user: string, from: string, to: string }} args
 * @param {{ commit?: boolean, log?: (line: string) => void }} [options]
 */
export async function carryStoredSteward(blobs, args, options = {}) {
  const { commit = false, log = () => {} } = options;
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
    const { data, revision } = await readNewest(blobs);
    const user = resolveUser(data, args.user);
    const next = structuredClone(data);
    const adoption = await carrySteward(dataCarryPort(next), {
      userId: user.id,
      fromPlate: args.from,
      toPlate: args.to,
    });
    log(
      `@${user.username} (${user.id}): ${args.from} → ${args.to}, keeping adoptedAt ${adoption.adoptedAt}.`,
    );
    if (!commit) {
      log(`\nDry run. Re-run with --commit to append rev/${revision + 1}.`);
      return { adoption, revision, committed: null };
    }
    const write = await blobs.set(revisionKey(revision + 1), JSON.stringify(next), {
      onlyIfNew: true,
    });
    if (write.modified) {
      await blobs.set(HEAD_KEY, String(revision + 1));
      log(`\nCommitted rev/${revision + 1}. To reverse: swap --from and --to.`);
      return { adoption, revision, committed: revision + 1 };
    }
    log(`rev/${revision + 1} was taken by a concurrent commit — re-reading.`);
  }
  throw new Error(`Lost ${MAX_COMMIT_ATTEMPTS} commits in a row — nothing was written.`);
}
