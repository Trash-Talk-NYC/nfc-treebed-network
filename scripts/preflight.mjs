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

// Not an error either: without a Brevo key the dev outbox stands in outside
// production, and in production the sign-in screen says email sign-in isn't
// ready while the rest of the flow carries on (src/lib/mail.ts). Said out
// loud so "no sign-in mail arrived" reads as the configured state it is.
if (!process.env.BREVO_API_KEY) {
  console.warn(
    'BREVO_API_KEY is not set: sign-in and digest mail go to the .data/outbox dev transport (or, in production, are disabled).',
  );
}

// Not an error, by design: a production server with no admin key has no
// admin surface at all (every /admin route answers 404 — src/lib/session.ts).
// Said out loud here because "the admin is 404" otherwise reads as a broken
// route rather than the safe default it is.
if (!process.env.TREEBED_ADMIN_KEY) {
  console.warn(
    'TREEBED_ADMIN_KEY is not set: the block admin (/admin) is disabled and answers 404.',
  );
}
