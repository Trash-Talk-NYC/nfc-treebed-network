// The signing secret, resolved WITHOUT `import.meta`.
//
// session.ts keeps its own production predicate, which reads
// `import.meta.env.PROD` — a Vite replacement, correct inside the app and
// absent everywhere Netlify bundles a file with its own esbuild (the scheduled
// digest function). Anything both sides touch resolves the secret through
// here: the environment variable production requires anyway, with the dev
// fallback file this module now OWNS, so a value signed or keyed by the
// scheduled function verifies in the app and vice versa.
//
// One owner for the fallback matters: two resolvers each generating and caching
// their own copy could race to create the file and then disagree about the key,
// which would make one construction's MAC unverifiable by the other.
//
// The env-var read stays live (it is one lookup, and caching it would freeze
// whatever the environment held at first use); the fallback file is read once.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isProductionLike } from './mail';

let devSecret: string | null = null;

/**
 * The dev-only fallback: generate once, keep it next to the JSON store, and
 * hand the same value to every caller for the life of the process.
 *
 * Never reachable in production — both callers refuse a generated secret there
 * first, on their own predicate.
 */
export function devFallbackSecret(): string {
  if (devSecret) return devSecret;
  const dir = process.env.TREEBED_DATA_DIR ?? path.resolve('.data');
  const file = path.join(dir, 'session-secret');
  try {
    devSecret = readFileSync(file, 'utf8').trim();
  } catch {
    devSecret = randomBytes(32).toString('hex');
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, devSecret, { mode: 0o600 });
  }
  return devSecret;
}

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
  return devFallbackSecret();
}
