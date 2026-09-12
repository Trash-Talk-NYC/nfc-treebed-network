// The store side of `seed-captain-facts.mjs`: put the captain's stated plant
// facts onto the four LIVE rows that hold them blank. Read the entry script
// first — it carries the rationale.
//
// Why a script at all: the captain said (2026-09-12) "with 8 and 9N say no
// plants and don't recommend planting" — two ids naming beds the live store
// already holds (BED-WH-1712 / BED-WH-1713) — and "say 2S has plants say 5S
// doesn't and that we don't recommend planting", two run beds a live store
// persisted blank before those facts reached the seed. The checked-in seed
// now carries all four, but `ensureCheckedInRecords` is insert-only and
// `normalizeData` is additive by decision, so nothing on the read path will
// ever set a field on a stored row — and an automatic backfill was rejected
// because it would resurrect the value every time the captain took the fact
// back to NOT RECORDED with the admin's own radio. A human runs this once
// instead, deliberately, through the shared forward-revision procedure
// (forward-revision.mjs): nothing wiped, no key deleted, a lost race
// re-reads rather than overwrites.
//
// Safety: a field is written ONLY while the stored row still reads NOT YET
// RECORDED (null, or undefined on a pre-normalization row). A value anybody
// has since set — the captain included — is left byte-for-byte, and the
// facts themselves are read from the checked-in seed, both halves of it
// (`w171Beds` for the renamed beds, `captainRunBeds` for the run rows), so
// this script cannot drift from what the repo says the captain said. Where
// the seed states no fact — 2S's planting recommendation, which he never
// gave — nothing is written.

import { captainRunBeds, w171Beds } from '../src/lib/checked-in-beds.ts';
import { commitForwardRevision } from './forward-revision.mjs';

/**
 * The plates whose facts the captain stated, and the fields he stated. The
 * two renamed beds (his "with 8 and 9N say no plants and don't recommend
 * planting") AND the two fresh run beds he spoke for in the same breath
 * ("say 2S has plants say 5S doesn't and that we don't recommend planting"):
 * 2SHFW171/5SHFW171 seed with the facts, but a live store that persisted
 * their rows in the window BEFORE the facts landed holds them blank, and the
 * insert-only seed can never reach a row that already exists.
 */
const CAPTAIN_FACT_PLATES = ['BED-WH-1712', 'BED-WH-1713', '2SHFW171', '5SHFW171'];
const CAPTAIN_FACT_FIELDS = ['plantsPresent', 'plantingRecommended'];

/**
 * A copy of the dataset with the captain-stated facts filled in where the
 * stored row still reads NOT YET RECORDED, and a per-field account of what
 * changed and what was deliberately left alone. The input is never mutated.
 */
export function fillCaptainFacts(data) {
  const next = structuredClone(data);
  const changes = [];
  const kept = [];
  const seedByPlate = new Map(
    [...w171Beds(), ...captainRunBeds()].map((bed) => [bed.plate, bed]),
  );
  for (const plate of CAPTAIN_FACT_PLATES) {
    const stored = next.beds?.[plate];
    const seed = seedByPlate.get(plate);
    if (!seed) {
      // The plate left the checked-in seed (a rename, a retirement). There is
      // no stated fact to copy, and guessing one at a live store is the last
      // thing this script may do.
      kept.push({ plate, field: '(row)', reason: 'no longer in the checked-in seed' });
      continue;
    }
    if (!stored) {
      // Not persisted yet: the next load inserts the seed row, facts
      // included, so there is nothing for this script to do — and nothing
      // to warn about.
      kept.push({ plate, field: '(row)', reason: 'not persisted yet — the seed carries the facts' });
      continue;
    }
    for (const field of CAPTAIN_FACT_FIELDS) {
      const current = stored[field] ?? null;
      const stated = seed[field] ?? null;
      if (stated === null) {
        // The seed asserts nothing here either, so there is nothing to fill:
        // writing null over null would still commit a whole-dataset revision.
        kept.push({ plate, field, reason: 'the checked-in seed states no fact' });
      } else if (current === null) {
        stored[field] = stated;
        changes.push({ plate, field, to: stated });
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
  const { result, revision, committed } = await commitForwardRevision(
    blobs,
    (data, revision) => {
      const { data: filled, changes, kept } = fillCaptainFacts(data);
      for (const { plate, field, to } of changes) log(`${plate}: ${field} → ${JSON.stringify(to)}`);
      for (const { plate, field, reason } of kept) log(`${plate}: ${field} left alone (${reason})`);
      if (changes.length === 0) {
        log(`rev/${revision}: nothing to fill — every stated fact is already recorded.`);
      }
      return { data: filled, result: { changes, kept }, skip: changes.length === 0 };
    },
    {
      commit,
      log,
      subject: 'fill',
      committedLine: (revision, { changes }) =>
        `Committed rev/${revision} (${changes.length} field(s) filled).`,
    },
  );
  return { ...result, revision, committed };
}
