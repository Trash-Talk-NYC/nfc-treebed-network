// The store side of `carry-steward.mjs`, in its own module so the entry
// script can check the Node version before anything imports a `.ts` file,
// and so tests/store-blobs.test.ts can drive this against the emulated Blobs
// server — the same wire protocol the pilot store speaks. Read the entry
// script first: it carries the whole rationale for the carry.
//
// The forward-revision procedure itself is shared (forward-revision.mjs):
// read the newest revision, apply the change to a copy, append it as
// `rev/<n+1>` with `onlyIfNew` — nothing wiped, no key deleted, no revision
// pruned, and a lost race re-reads rather than overwrites.

import { CarryRefusal, carrySteward, dataCarryPort } from '../src/lib/steward-carry.ts';
import { ensureCheckedInRecords } from '../src/lib/checked-in-beds.ts';
import { commitForwardRevision } from './forward-revision.mjs';

export { CarryRefusal };

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
  const { result, revision, committed } = await commitForwardRevision(
    blobs,
    async (data) => {
      const user = resolveUser(data, args.user);
      const next = structuredClone(data);
      // The checked-in records first, the same insert-only pass every load
      // makes (`ensureCheckedInRecords`): the named-run beds exist as
      // checked-in seed until some commit happens to persist them, so without
      // this the carry would refuse the captain's own day-one target as a bed
      // that does not exist. What this appends is therefore exactly what the
      // next `normalizeData` load would have inserted anyway — nothing is
      // overwritten, and a bed the store already holds keeps every edit.
      ensureCheckedInRecords(next);
      const adoption = await carrySteward(dataCarryPort(next), {
        userId: user.id,
        fromPlate: args.from,
        toPlate: args.to,
      });
      log(
        `@${user.username} (${user.id}): ${args.from} → ${args.to}, keeping adoptedAt ${adoption.adoptedAt}.`,
      );
      return { data: next, result: { adoption } };
    },
    {
      commit,
      log,
      subject: 'carry',
      committedLine: (revision) => `Committed rev/${revision}. To reverse: swap --from and --to.`,
    },
  );
  return { ...result, revision, committed };
}
