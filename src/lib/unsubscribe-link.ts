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
// The secret is resolved through signing-secret.ts, WITHOUT import.meta
// (unlike session.ts, whose `import.meta.env.PROD` is a Vite replacement this
// module cannot rely on — the scheduled digest function is bundled outside the
// Vite build), so links signed by the scheduled function verify in the app and
// vice versa.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { langLink } from './i18n';
import { signingSecret } from './signing-secret';
import type { User } from './types';

function unsubscribeMac(userId: string): string {
  return createHmac('sha256', signingSecret())
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
