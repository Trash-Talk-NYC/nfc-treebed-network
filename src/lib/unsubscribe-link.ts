// The signed one-click unsubscribe link — build and verify.
//
// The link in every digest flips that steward's digest off with no sign-in:
// the recipient of the mail IS the authorization, so the link has to prove
// it came from a mail we sent and name whom it unsubscribes — an HMAC over
// the user id, keyed by the same secret the session cookies use. No expiry:
// an unsubscribe link that stops working is a spam complaint instead.
//
// On its own rather than inside digest.ts because both sides need it and
// only one may carry prose: the unsubscribe SCREEN imports the verify half,
// and every lib module a screen imports is held prose-free by
// tests/i18n.test.ts; the digest builder imports the build half.
//
// The secret is resolved WITHOUT import.meta (unlike session.ts, whose
// `import.meta.env.PROD` is a Vite replacement this module cannot rely on —
// the scheduled digest function is bundled outside the Vite build): the
// environment variable production requires anyway, with the same `.data/`
// dev fallback file session.ts keeps, so links signed by the scheduled
// function verify in the app and vice versa.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { langLink } from './i18n';
import { isProductionLike } from './mail';
import type { User } from './types';

function unsubscribeSecret(): string {
  const configured = process.env.TREEBED_SESSION_SECRET;
  if (configured) return configured;
  // The same refusal session.ts makes, because the failure mode here is
  // worse than a crash: on a function instance a generated fallback would be
  // a per-instance secret, and every unsubscribe link in a sent digest would
  // verify nowhere — dead links on the one control a recipient must be able
  // to trust. The dev fallback below is for local runs only.
  if (isProductionLike()) {
    throw new Error(
      'TREEBED_SESSION_SECRET must be set in production — refusing to sign unsubscribe links with a generated secret.',
    );
  }
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

function unsubscribeMac(userId: string): string {
  return createHmac('sha256', unsubscribeSecret())
    .update(`digest-unsubscribe:${userId}`)
    .digest('base64url');
}

/** The path-and-query half of the unsubscribe link, in the user's language. */
export function unsubscribePath(user: User): string {
  const params = new URLSearchParams({ u: user.id, s: unsubscribeMac(user.id) });
  return langLink(`/digest/unsubscribe?${params.toString()}`, user.lang);
}

/** Whether an unsubscribe link's signature is one of ours for this user. */
export function verifyUnsubscribe(userId: string, mac: string): boolean {
  const expected = Buffer.from(unsubscribeMac(userId));
  const given = Buffer.from(mac);
  if (given.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(given, expected);
}
