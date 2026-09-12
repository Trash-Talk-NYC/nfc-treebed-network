// One-off remediation: retire the two blank bed rows PR #29 left stranded on
// the LIVE store when the captain's rename arrived (2026-09-12).
//
// PR #29 seeded `8NHFW171` and `9NHFW171` as fresh beds of the north run and
// deployed. Then, standing at the beds, the captain said those two ids name
// beds the network already held: "Can you change …/t/1hc0t9cj for the end to
// be 9NHFW171 and then …/t/729v19w4 change to 8NHFW171". So the seed stopped
// minting them and the tags now resolve to BED-WH-1713 / BED-WH-1712 — but
// the rows PR #29 already wrote are still in the live store, in the captain's
// north-run block, reachable by no tag. Seeding is insert-only and
// `normalizeData` is additive by decision, so nothing on the read path will
// ever take them away. A human runs this once instead, through the same
// forward-revision shape as the other remediations (forward-revision.mjs).
//
// It RETIRES (`Bed.retiredAt`), never deletes: the row, the plate and any
// history stay, the bed drops off the street list, and the admin's own
// RESTORE puts it back if this was wrong. One thing refuses the retire — an
// ACTIVE adoption, a person still standing on the record (somebody may have
// adopted the blank duplicate through the live URLs before the rename); that
// row is reported and left alone for a human to carry the steward off with
// scripts/carry-steward.mjs and then decide, and the carry's own leftovers —
// a RELEASED adoption keyed to the plate — deliberately do not refuse the
// re-run, or the instructed recovery could never finish. Anything else a row
// still carries (a bed name, reports, events, a profile edit) is kept by the
// retire and named in its report line. The store side lives in
// orphan-run-beds-apply.mjs, where the tests drive it against the emulated
// Blobs server.
//
// Requires Node >= 22.18: the apply module's import path reaches `.ts`
// modules directly, which only resolves where type stripping is on without a
// flag.
//
// Usage (dry run prints what would change and writes nothing):
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/retire-orphan-run-beds.mjs
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/retire-orphan-run-beds.mjs --commit
//
// Both variables are required: `@netlify/blobs` reads credentials from
// `NETLIFY_BLOBS_CONTEXT` or from an explicit siteID+token, never from the
// environment names above, so they are passed through by hand below. A
// missing one exits non-zero rather than letting the run look like a no-op.

// This file imports no `.ts` module statically, and must not start: the
// version check below has to run before such an import is attempted, and a
// static one is hoisted above every statement here.
const MIN_NODE_VERSION = [22, 18];

/**
 * A refusal this script made on purpose — a Node too old, a credential
 * missing. Its message is the whole story, so it prints as a sentence;
 * anything else prints whole, because the stack and the cause are what a
 * human needs when this is pointed at the captain's live store.
 */
class Refusal extends Error {}

function requireSupportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const [minMajor, minMinor] = MIN_NODE_VERSION;
  if (major > minMajor || (major === minMajor && minor >= minMinor)) return;
  throw new Refusal(
    `Node ${process.versions.node} is too old: this script imports TypeScript ` +
      `modules directly, which needs unflagged type stripping (Node >= ` +
      `${minMajor}.${minMinor}).`,
  );
}

function requireCredentials(storeName) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) return { siteID, token };
  const missing = [siteID ? null : 'NETLIFY_SITE_ID', token ? null : 'NETLIFY_AUTH_TOKEN'].filter(
    Boolean,
  );
  throw new Refusal(
    `Missing ${missing.join(' and ')}. This script was about to read the ` +
      `"${storeName}" Blobs store and append a revision retiring the two ` +
      `orphaned run-bed rows; both NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN ` +
      `are required to reach it.`,
  );
}

async function main() {
  requireSupportedNode();
  const [{ getStore }, { STORE_NAME }, { retireStoredOrphanRunBeds }] = await Promise.all([
    import('@netlify/blobs'),
    import('../src/lib/store-keys.ts'),
    import('./orphan-run-beds-apply.mjs'),
  ]);
  const { siteID, token } = requireCredentials(STORE_NAME);
  const blobs = getStore({ name: STORE_NAME, consistency: 'strong', siteID, token });
  await retireStoredOrphanRunBeds(blobs, {
    commit: process.argv.includes('--commit'),
    log: (line) => console.log(line),
  });
}

main().catch((err) => {
  console.error(err instanceof Refusal ? err.message : err);
  process.exit(1);
});
