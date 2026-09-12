// The store side of `seed-captain-facts.mjs`: put the captain's stated plant
// facts onto the two LIVE rows his named ids landed on. Read the entry
// script first — it carries the rationale.
//
// Why a script at all: the captain said (2026-09-12) "with 8 and 9N say no
// plants and don't recommend planting", and those two ids name beds the live
// store already holds (BED-WH-1712 / BED-WH-1713). The checked-in seed now
// carries the facts, but `ensureCheckedInRecords` is insert-only and
// `normalizeData` is additive by decision, so nothing on the read path will
// ever set a field on a stored row — and an automatic backfill was rejected
// because it would resurrect the value every time the captain took the fact
// back to NOT RECORDED with the admin's own radio. A human runs this once
// instead, deliberately, in the same forward-revision shape as
// rewrite-species-casing.mjs: nothing wiped, no key deleted, a lost race
// re-reads rather than overwrites.
//
// Safety: a field is written ONLY while the stored row still reads NOT YET
// RECORDED (null, or undefined on a pre-normalization row). A value anybody
// has since set — the captain included — is left byte-for-byte, and the
// facts themselves are read from the checked-in seed (`w171Beds`), so this
// script cannot drift from what the repo says the captain said.

import { w171Beds } from '../src/lib/checked-in-beds.ts';
import { HEAD_KEY, REVISION_PREFIX } from '../src/lib/store-keys.ts';

const MAX_COMMIT_ATTEMPTS = 5;

/** The plates whose facts the captain stated, and the fields he stated. */
const CAPTAIN_FACT_PLATES = ['BED-WH-1712', 'BED-WH-1713'];
const CAPTAIN_FACT_FIELDS = ['plantsPresent', 'plantingRecommended'];

const revisionKey = (revision) => `${REVISION_PREFIX}${revision}`;

/** The newest revision in the chain — the head pointer is a lower bound. */
async function readNewest(blobs) {
  const raw = await blobs.get(HEAD_KEY, { type: 'text' });
  const head = Number(raw);
  let revision = Number.isInteger(head) && head > 0 ? head : await newestListed(blobs);
  let data = await blobs.get(revisionKey(revision), { type: 'json' });
  if (data === null) throw new Error(`No dataset at ${revisionKey(revision)} — nothing to fill.`);
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
  if (newest === 0) throw new Error('No revisions in the store — nothing to fill.');
  return newest;
}

/**
 * A copy of the dataset with the captain-stated facts filled in where the
 * stored row still reads NOT YET RECORDED, and a per-field account of what
 * changed and what was deliberately left alone. The input is never mutated.
 */
export function fillCaptainFacts(data) {
  const next = structuredClone(data);
  const changes = [];
  const kept = [];
  const seedByPlate = new Map(w171Beds().map((bed) => [bed.plate, bed]));
  for (const plate of CAPTAIN_FACT_PLATES) {
    const stored = next.beds?.[plate];
    const seed = seedByPlate.get(plate);
    if (!stored) {
      // Not persisted yet: the next load inserts the seed row, facts
      // included, so there is nothing for this script to do — and nothing
      // to warn about.
      kept.push({ plate, field: '(row)', reason: 'not persisted yet — the seed carries the facts' });
      continue;
    }
    for (const field of CAPTAIN_FACT_FIELDS) {
      const current = stored[field] ?? null;
      if (current === null) {
        stored[field] = seed[field];
        changes.push({ plate, field, to: seed[field] });
      } else {
        kept.push({ plate, field, reason: `already ${JSON.stringify(current)} — somebody has said` });
      }
    }
  }
  return { data: next, changes, kept };
}

/**
 * Read the newest revision, fill what is safe to fill, and (with `commit`)
 * append the result as the next revision. Returns what changed.
 *
 * @param {import('@netlify/blobs').Store} blobs
 * @param {{ commit?: boolean, log?: (line: string) => void }} [options]
 */
export async function fillStoredCaptainFacts(blobs, options = {}) {
  const { commit = false, log = () => {} } = options;
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
    const { data, revision } = await readNewest(blobs);
    const { data: filled, changes, kept } = fillCaptainFacts(data);
    for (const { plate, field, to } of changes) log(`${plate}: ${field} → ${JSON.stringify(to)}`);
    for (const { plate, field, reason } of kept) log(`${plate}: ${field} left alone (${reason})`);
    if (changes.length === 0) {
      log(`rev/${revision}: nothing to fill — every stated fact is already recorded.`);
      return { changes, kept, revision, committed: null };
    }
    if (!commit) {
      log(`\nDry run. Re-run with --commit to append rev/${revision + 1}.`);
      return { changes, kept, revision, committed: null };
    }
    const write = await blobs.set(revisionKey(revision + 1), JSON.stringify(filled), {
      onlyIfNew: true,
    });
    if (write.modified) {
      await blobs.set(HEAD_KEY, String(revision + 1));
      log(`\nCommitted rev/${revision + 1} (${changes.length} field(s) filled).`);
      return { changes, kept, revision, committed: revision + 1 };
    }
    log(`rev/${revision + 1} was taken by a concurrent commit — re-reading.`);
  }
  throw new Error(`Lost ${MAX_COMMIT_ATTEMPTS} commits in a row — nothing was written.`);
}
