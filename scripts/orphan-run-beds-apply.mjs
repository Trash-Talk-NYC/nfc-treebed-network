// The store side of `retire-orphan-run-beds.mjs`: retire the two blank rows
// PR #29 seeded for `8NHFW171` and `9NHFW171` before the captain's rename
// arrived. Read the entry script first — it carries the rationale.
//
// Why a script at all: PR #29 shipped those two plates as FRESH beds, and it
// deployed, so the live pilot store holds them. The rename (2026-09-12) made
// the same two ids the captain's names for beds the network already had
// (BED-WH-1713 / BED-WH-1712), so the seed no longer mints them and the tags
// `8nhfw171`/`9nhfw171` now resolve elsewhere — but seeding is insert-only
// and `normalizeData` is additive by decision, so nothing on the read path
// takes a stored row away. Left alone, the captain's north-run street list
// carries two beds no tag reaches, forever.
//
// RETIREMENT, never deletion: `retiredAt` drops the bed off the street list
// and answers not-found everywhere, while the row, its plate and its history
// stay, and the admin's own RESTORE (restoreBedByAdmin) undoes it. Nothing
// re-inserts a retired row, because the seed no longer names these plates.
//
// Safety: one thing refuses a retire, and it is an ACTIVE adoption — a person
// still standing on the record. Somebody may have adopted the blank duplicate
// through the live URLs in the window between the PR-29 deploy and the
// rename, and that adoption is a person's, not a duplicate to tidy away; such
// a row is REPORTED and left byte-for-byte, for a human to carry the steward
// off with `scripts/carry-steward.mjs` and then decide.
//
// A RELEASED adoption deliberately does not refuse: it is the carry's own end
// state — `carrySteward` stamps `releasedAt` and leaves the adoption keyed to
// the plate it was written on — so refusing it would make the instructed
// recovery impossible to finish. Nor does a bed name, a report, an event or a
// profile edit: retiring keeps all of it, and the admin's RESTORE brings the
// row back whole. What the tombstone will still carry is named in the report
// line instead, so the human running this sees exactly what they retired.

import { commitForwardRevision } from './forward-revision.mjs';

/**
 * The plates PR #29 seeded and the rename orphaned. Not derived from the
 * seed: the seed no longer names them, which is the whole reason these rows
 * are stranded.
 */
export const ORPHAN_RUN_PLATES = ['8NHFW171', '9NHFW171'];

/** What the fresh run seed put on a bed — anything else somebody wrote there. */
const BLANK_SEED = {
  plantingSpaceId: null,
  plantingSpaceGlobalId: null,
  treeType: null,
  treeId: '',
  bedName: null,
  tagUid: '',
  address: '',
  slots: 1,
  offeredSlots: 1,
  guard: null,
  treePresent: null,
  plantsPresent: null,
  plantsNote: '',
  plantingRecommended: null,
  recommendedPlantsNote: '',
  careNote: '',
};

/**
 * Why this row may not be retired, or null if it may be.
 *
 * Only a live steward refuses. A released adoption is what the documented
 * recovery leaves behind, so it is disclosed rather than treated as a block.
 */
function blockingOn(data, plate) {
  if (data.adoptions?.some((a) => a.bedPlate === plate && (a.releasedAt ?? null) === null)) {
    return 'it carries an active adoption — carry the steward off it first (scripts/carry-steward.mjs)';
  }
  return null;
}

/**
 * What a retire would keep on this row that somebody put there — named so the
 * human running this reads the tombstone's contents rather than assuming it
 * held nothing.
 *
 * A pre-normalization row carries `undefined` where a later field was added,
 * which reads the same as the seed's null/empty — `?? BLANK_SEED[field]`.
 */
function humanTracesOn(data, plate, bed) {
  const traces = [];
  const released = data.adoptions?.filter((a) => a.bedPlate === plate).length ?? 0;
  if (released > 0) traces.push(`${released} released adoption(s)`);
  const reports = data.reports?.filter((r) => r.bedPlate === plate).length ?? 0;
  if (reports > 0) traces.push(`${reports} report(s)`);
  const events = data.events?.filter((e) => e.bedPlate === plate).length ?? 0;
  if (events > 0) traces.push(`${events} event(s)`);
  for (const [field, blank] of Object.entries(BLANK_SEED)) {
    const current = bed[field] ?? blank;
    if (JSON.stringify(current) !== JSON.stringify(blank)) {
      traces.push(`${field} = ${JSON.stringify(current)}`);
    }
  }
  return traces;
}

/**
 * A copy of the dataset with the orphan rows retired where that is safe, and
 * a per-row account of what was retired and what was deliberately left alone.
 * The input is never mutated.
 *
 * @param {any} data
 * @param {string} retiredAt the stamp to write, so a run is reproducible
 */
export function retireOrphanRunBeds(data, retiredAt = new Date().toISOString()) {
  const next = structuredClone(data);
  const changes = [];
  const kept = [];
  for (const plate of ORPHAN_RUN_PLATES) {
    const bed = next.beds?.[plate];
    if (!bed) {
      // Never persisted — a store seeded after the rename never had the row.
      kept.push({ plate, reason: 'not in this store — nothing was orphaned here' });
      continue;
    }
    if ((bed.retiredAt ?? null) !== null) {
      kept.push({ plate, reason: `already retired at ${bed.retiredAt}` });
      continue;
    }
    const blocked = blockingOn(next, plate);
    if (blocked) {
      kept.push({ plate, reason: blocked });
      continue;
    }
    const carries = humanTracesOn(next, plate, bed);
    bed.retiredAt = retiredAt;
    changes.push({ plate, retiredAt, carries });
  }
  return { data: next, changes, kept };
}

/**
 * Read the newest revision, retire what is safe to retire, and (with
 * `commit`) append the result as the next revision. Returns what changed.
 *
 * @param {import('@netlify/blobs').Store} blobs
 * @param {{ commit?: boolean, log?: (line: string) => void, now?: () => string }} [options]
 */
export async function retireStoredOrphanRunBeds(blobs, options = {}) {
  const { commit = false, log = () => {}, now = () => new Date().toISOString() } = options;
  const { result, revision, committed } = await commitForwardRevision(
    blobs,
    (data, revision) => {
      const { data: retired, changes, kept } = retireOrphanRunBeds(data, now());
      for (const { plate, retiredAt, carries } of changes) {
        const held = carries.length > 0 ? ` — the tombstone still holds ${carries.join(', ')}` : '';
        log(`${plate}: retired at ${retiredAt}${held}`);
      }
      for (const { plate, reason } of kept) log(`${plate}: left alone (${reason})`);
      if (changes.length === 0) {
        log(`rev/${revision}: nothing to retire — no orphan row stands here.`);
      }
      return { data: retired, result: { changes, kept }, skip: changes.length === 0 };
    },
    {
      commit,
      log,
      subject: 'retire',
      committedLine: (revision, { changes }) =>
        `Committed rev/${revision} (${changes.length} row(s) retired; restore from the admin if this was wrong).`,
    },
  );
  return { ...result, revision, committed };
}
