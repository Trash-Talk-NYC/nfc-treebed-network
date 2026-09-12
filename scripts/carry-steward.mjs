// Carry a steward from one bed's record to another's on the LIVE store —
// the day the captain stands at his tree and says which of the 22 named-run
// beds (store-dataset.ts, `captainRunBeds`) is the one his adoption on
// BED-WH-1711 actually belongs to. Nothing can map the old records onto the
// new ids for him: his street numbers are loose cluster references, not
// locators, so the answer only exists at the tree.
//
// The rule is `carrySteward` in src/lib/steward-carry.ts — the same rule the
// service layer and the tests run — and its header says exactly what moves
// (the adoption, keeping its original `adoptedAt`) and what stays (reports,
// events, the bed's given name; sites own history). REVERSIBLE: run it again
// with --from and --to swapped and the original state is restored.
//
// It follows rewrite-species-casing.mjs, the sanctioned forward-revision
// shape (AGENTS.md, seed data): read the newest revision, apply the change
// to a copy, append it as `rev/<n+1>` with `onlyIfNew` — nothing wiped, no
// key deleted, no revision pruned, and a lost race re-reads rather than
// overwrites. The store side lives in steward-carry-apply.mjs, where
// tests/store-blobs.test.ts drives it against the emulated Blobs server.
// Dry run by default; nothing is written without --commit.
//
// Requires Node >= 22.18 (the apply module imports `.ts` files directly,
// which only resolves where type stripping is on without a flag), and both
// Blobs credentials — `@netlify/blobs` reads neither on its own.
//
// Usage (the user may be named by their public @username or their user id):
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/carry-steward.mjs \
//     --user marisol_r --from BED-WH-1711 --to 5SHFW171
//   …and the same with --commit to write.

// This file imports no `.ts` module statically, and must not start: the
// version check below has to run before such an import is attempted, and a
// static one is hoisted above every statement here.
const MIN_NODE_VERSION = [22, 18];

/**
 * A refusal this script made on purpose — a Node too old, a credential or
 * argument missing, a rule saying no. Its message is the whole story, so it
 * prints as a sentence; anything else prints whole, stack and cause, because
 * this is pointed at the captain's live store.
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
      `"${storeName}" Blobs store and append a revision carrying a steward ` +
      `between beds; both NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are ` +
      `required to reach it.`,
  );
}

/** `--user marisol_r --from BED-WH-1711 --to 5SHFW171 [--commit]`. */
function parseArgs(argv) {
  const args = { commit: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--commit') args.commit = true;
    else if (flag === '--user' || flag === '--from' || flag === '--to') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Refusal(`${flag} needs a value.`);
      args[flag.slice(2)] = value;
    } else throw new Refusal(`Unknown argument ${flag}.`);
  }
  const missing = ['user', 'from', 'to'].filter((k) => !args[k]);
  if (missing.length > 0) {
    throw new Refusal(
      `Missing --${missing.join(', --')}. Usage: node scripts/carry-steward.mjs ` +
        `--user <username or user id> --from <plate> --to <plate> [--commit]`,
    );
  }
  return args;
}

async function main() {
  requireSupportedNode();
  const args = parseArgs(process.argv.slice(2));
  const [{ getStore }, { STORE_NAME }, { CarryRefusal, carryStoredSteward }] = await Promise.all([
    import('@netlify/blobs'),
    import('../src/lib/store-keys.ts'),
    import('./steward-carry-apply.mjs'),
  ]);
  const { siteID, token } = requireCredentials(STORE_NAME);
  const blobs = getStore({ name: STORE_NAME, consistency: 'strong', siteID, token });
  try {
    await carryStoredSteward(blobs, args, { commit: args.commit, log: (line) => console.log(line) });
  } catch (err) {
    if (err instanceof CarryRefusal) throw new Refusal(`The rule refused: ${err.message}`);
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Refusal ? err.message : err);
  process.exit(1);
});
