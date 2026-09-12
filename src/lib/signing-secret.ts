// The signing secret, resolved WITHOUT `import.meta`.
//
// session.ts has its own copy that reads `import.meta.env.PROD`, which is a
// Vite replacement — correct inside the app, absent everywhere Netlify bundles
// a file with its own esbuild (the scheduled digest function). Anything both
// sides touch resolves the secret through here instead: the environment
// variable production requires anyway, with the same `.data/` dev fallback
// file session.ts keeps, so a value signed or keyed by the scheduled function
// verifies in the app and vice versa.
//
// Not memoized on purpose: the callers are per-request, the fallback path is
// one small read, and a cached value would freeze whatever the environment
// held at first use.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isProductionLike } from './mail';

/**
 * The shared HMAC key.
 *
 * Refusing a generated secret in production is the same call session.ts makes,
 * and matters more here: on a function instance a generated fallback would be
 * a PER-INSTANCE key, so every unsubscribe link in a sent digest would verify
 * nowhere and the sign-in ledger would count a separate window per instance.
 */
export function signingSecret(): string {
  const configured = process.env.TREEBED_SESSION_SECRET;
  if (configured) return configured;
  if (isProductionLike()) {
    throw new Error(
      'TREEBED_SESSION_SECRET must be set in production — refusing to sign unsubscribe links or key the sign-in ledger with a generated secret.',
    );
  }
  // Local-dev fallback: generate once and keep it next to the JSON store,
  // which is the file session.ts writes and reads too.
  const dir = process.env.TREEBED_DATA_DIR ?? path.resolve('.data');
  const file = path.join(dir, 'session-secret');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    const secret = randomBytes(32).toString('hex');
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}
