// One-off remediation: put the captain's stated plant facts onto the four
// LIVE beds that hold them blank (2026-09-12).
//
// His words: "with 8 and 9N say no plants and don't recommend planting" —
// and 8NHFW171 / 9NHFW171 are the EXISTING beds BED-WH-1713 / BED-WH-1712
// ("Can you change …/t/1hc0t9cj for the end to be 9NHFW171 and then
// …/t/729v19w4 change to 8NHFW171") — plus "say 2S has plants say 5S doesn't
// and that we don't recommend planting", whose rows (2SHFW171 / 5SHFW171)
// the live store persisted blank in the window between the deploy that
// seeded them and the facts landing in the seed. The checked-in seed now
// carries all four, but seeding is insert-only and `normalizeData` is
// additive by decision, so nothing on the read path will ever set a field a
// stored row already lacks a value for. A human runs this once instead — the same
// forward-revision shape as rewrite-species-casing.mjs, and the same reason
// it is not an automatic backfill: an automatic one would resurrect the
// value every time the captain took the fact back to NOT RECORDED with the
// admin's own radio.
//
// A field is written ONLY while the stored row still reads NOT YET RECORDED,
// and only where the seed states a fact — 2S's planting recommendation, which
// the captain never gave, is left unrecorded; anything anybody has since set
// is reported and left byte-for-byte. The store side lives in
// captain-facts-apply.mjs, where the tests drive it against the emulated
// Blobs server.
//
// Requires Node >= 22.18: the apply module imports `.ts` modules directly,
// which only resolves where type stripping is on without a flag.
//
// Usage (dry run prints what would change and writes nothing):
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/seed-captain-facts.mjs
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/seed-captain-facts.mjs --commit
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
      `"${storeName}" Blobs store and append a revision filling the captain's ` +
      `stated plant facts; both NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are ` +
      `required to reach it.`,
  );
}

async function main() {
  requireSupportedNode();
  const [{ getStore }, { STORE_NAME }, { fillStoredCaptainFacts }] = await Promise.all([
    import('@netlify/blobs'),
    import('../src/lib/store-keys.ts'),
    import('./captain-facts-apply.mjs'),
  ]);
  const { siteID, token } = requireCredentials(STORE_NAME);
  const blobs = getStore({ name: STORE_NAME, consistency: 'strong', siteID, token });
  await fillStoredCaptainFacts(blobs, {
    commit: process.argv.includes('--commit'),
    log: (line) => console.log(line),
  });
}

main().catch((err) => {
  console.error(err instanceof Refusal ? err.message : err);
  process.exit(1);
});
