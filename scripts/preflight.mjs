// Boot gate for `npm start` and `npm run preview` (npm runs it as prestart
// and prepreview).
//
// The same requirement `getSecret()` enforces in src/lib/session.ts, checked
// before the server binds a port: a missing secret should stop the deploy,
// not wait to be discovered by traffic. `astro preview` serves the production
// build, so it is under the same requirement and gets the same one-line
// explanation instead of a stack trace. Servers started some other way still
// hit the assertion in src/middleware.ts on their first request.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Both scripts serve the node target's build, and `npm run test:netlify-build`
// empties dist/ to write a netlify one — so the entry can be missing on a
// checkout that has been built, which reads as a broken install rather than
// the wrong target.
const NODE_ENTRY = new URL('../dist/server/entry.mjs', import.meta.url);
if (!existsSync(NODE_ENTRY)) {
  console.error(
    `${fileURLToPath(NODE_ENTRY)} is missing — run \`npm run build\` to build the node target ` +
      '(a netlify-target build empties dist/ and emits its function under .netlify/ instead).',
  );
  process.exit(1);
}

if (!process.env.TREEBED_SESSION_SECRET) {
  console.error(
    'TREEBED_SESSION_SECRET must be set to start the server — refusing to sign cookies with a generated secret.',
  );
  process.exit(1);
}

// The one bound whose test-seam value turns a feature off rather than down.
// Said here because this is the only code that runs before the port is bound:
// the adapter imports every page chunk *and* the middleware lazily, so the
// warning in src/middleware.ts is the first request of any route, not boot.
const pinHashes = process.env.TREEBED_MAX_INFLIGHT_PIN_HASHES;
if (pinHashes !== undefined && pinHashes !== '' && Number(pinHashes) < 1) {
  console.warn(
    `TREEBED_MAX_INFLIGHT_PIN_HASHES=${pinHashes}: sign-in is disabled, every attempt answers busy.`,
  );
}
