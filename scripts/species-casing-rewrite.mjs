// The rewrite rule behind `rewrite-species-casing.mjs`, in its own module so
// the entry script can check the Node version before anything imports a `.ts`
// file — the import itself is what fails on Node < 22.18, and it fails with
// ERR_UNKNOWN_FILE_EXTENSION rather than a sentence. Read that script first:
// it carries the whole rationale for this remediation.

import { englishSpeciesFor, tableSpeciesCasingFor } from '../src/lib/tree-species.ts';
import { commitForwardRevision } from './forward-revision.mjs';

/**
 * The table's own spelling of an English common name a store holds, when the
 * two differ only in casing — otherwise null, meaning "that is their name,
 * not ours". The mirror of `tableSpeciesCasingFor` for the English half: the
 * table authors each species the way it should read mid-sentence ("willow
 * oak", but "Norway maple"), and a species the table has never heard of is
 * whatever the person standing at the tree typed.
 *
 * @param {string} stored
 * @returns {string | null}
 */
function tableEnglishCasingFor(stored) {
  const expected = englishSpeciesFor(stored);
  if (expected === null) return null;
  return stored.toLowerCase() === expected.toLowerCase() ? expected : null;
}

/**
 * The table's own spelling of one bed's species names, field by field, or
 * null for a field whose value the table does not own — a name somebody
 * typed, which is left byte-for-byte.
 *
 * @param {{ en: string, es: string } | null | undefined} treeType
 * @returns {{ en: string | null, es: string | null }}
 */
export function tableOwnedSpecies(treeType) {
  const en = treeType?.en ?? '';
  return { en: tableEnglishCasingFor(en), es: tableSpeciesCasingFor(en, treeType?.es ?? '') };
}

const KEPT_TYPED = "not the table's own name — left as typed";
const KEPT_CORRECT = 'already the table\'s own spelling';

/**
 * A copy of the dataset with the fixable species names corrected — both
 * halves of `treeType`, each held to the same rule — plus the full account of
 * the decision: what changed, and what was deliberately left alone. A human
 * pointing this at the captain's live store needs the second list as much as
 * the first, because a name the table does not own is a name somebody typed,
 * and reading it in the output is how they confirm the rule reached no
 * further than casing. The input is never mutated.
 *
 * @template {import('../src/lib/store-dataset.ts').Data} T
 * @param {T} data
 * @returns {{
 *   data: T,
 *   changes: Array<{ plate: string, field: 'en' | 'es', from: string, to: string }>,
 *   kept: Array<{ plate: string, field: 'en' | 'es', value: string, reason: string }>,
 * }}
 */
export function rewriteSpeciesCasing(data) {
  const next = structuredClone(data);
  const changes = [];
  const kept = [];
  for (const [plate, bed] of Object.entries(next.beds ?? {})) {
    // A species nobody has recorded yet has nothing to correct, and nothing
    // to report either — it is no value the rule declined to touch.
    if (!bed.treeType) continue;
    const owned = tableOwnedSpecies(bed.treeType);
    for (const field of ['en', 'es']) {
      const stored = bed.treeType[field] ?? '';
      const expected = owned[field];
      if (expected === null) {
        kept.push({ plate, field, value: stored, reason: KEPT_TYPED });
      } else if (expected === stored) {
        kept.push({ plate, field, value: stored, reason: KEPT_CORRECT });
      } else {
        changes.push({ plate, field, from: stored, to: expected });
        bed.treeType = { ...bed.treeType, [field]: expected };
      }
    }
  }
  return { data: next, changes, kept };
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
  const { result, revision, committed } = await commitForwardRevision(
    blobs,
    (data, revision) => {
      const { data: rewritten, changes, kept } = rewriteSpeciesCasing(data);
      for (const { plate, field, value, reason } of kept) {
        log(`  kept  ${plate} ${field}: "${value}" — ${reason}`);
      }
      if (changes.length === 0) {
        log(`rev/${revision}: every species name is already the table's own — nothing to do.`);
      }
      for (const { plate, field, from, to } of changes) {
        log(`change ${plate} ${field}: "${from}" → "${to}"`);
      }
      return { data: rewritten, result: { changes, kept }, skip: changes.length === 0 };
    },
    {
      commit,
      log,
      subject: 'rewrite',
      committedLine: (revision, { changes }) =>
        `Committed rev/${revision} (${changes.length} field(s) rewritten).`,
    },
  );
  return { ...result, revision, committed };
}
