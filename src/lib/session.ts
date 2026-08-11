// Cookie identity, two kinds:
//
//  - `tg_session`: the signed-in adopter (user id). Set on sign-in / adopt.
//  - `tg_visitor`: an anonymous visitor id, minted on first write action, so
//    the one-report-per-person-per-day rule has an identity to hang on for
//    people who never sign in. Best-effort by nature (clearing cookies mints
//    a new identity) — recorded as a known MVP limitation in AGENTS.md.
//
// Both cookies are HMAC-signed so a value edited in devtools is rejected
// server-side. The secret lives outside the repo (.data/, gitignored).

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AstroCookies } from 'astro';

const SESSION_COOKIE = 'tg_session';
const VISITOR_COOKIE = 'tg_visitor';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

let secret: string | null = null;

function isProduction(): boolean {
  return import.meta.env.PROD === true || process.env.NODE_ENV === 'production';
}

function getSecret(): string {
  if (secret) return secret;
  if (process.env.TREEBED_SESSION_SECRET) {
    secret = process.env.TREEBED_SESSION_SECRET;
    return secret;
  }
  if (isProduction()) {
    // Failing loudly beats the silent version: a generated secret means every
    // restart signs out everyone, and two instances reject each other's cookies.
    throw new Error(
      'TREEBED_SESSION_SECRET must be set in production — refusing to sign cookies with a generated secret.',
    );
  }
  // Local-dev fallback: generate once and keep next to the JSON store.
  const dir = process.env.TREEBED_DATA_DIR ?? path.resolve('.data');
  const file = path.join(dir, 'session-secret');
  try {
    secret = readFileSync(file, 'utf8').trim();
  } catch {
    secret = randomBytes(32).toString('hex');
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, secret, { mode: 0o600 });
  }
  return secret;
}

/**
 * Force the secret to resolve now, so a missing one is a startup failure
 * rather than a surprise on the first request that happens to touch a cookie.
 * Called from the middleware, which the adapter loads ahead of any route.
 */
export function assertSessionSecret(): void {
  getSecret();
}

function sign(value: string): string {
  const mac = createHmac('sha256', getSecret()).update(value).digest('base64url');
  return `${value}.${mac}`;
}

function unsign(signed: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const mac = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(createHmac('sha256', getSecret()).update(value).digest('base64url'));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  return value;
}

const cookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  // Astro forwards these options to cookie.serialize() verbatim — nothing
  // derives `secure` from the request scheme, so a year-long identity cookie
  // only stays off plaintext links if we set it here. Dev runs on http, where
  // a Secure cookie would never come back.
  secure: isProduction(),
  maxAge: YEAR_SECONDS,
} as const;

export function getSessionUserId(cookies: AstroCookies): string | null {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  return raw ? unsign(raw) : null;
}

export function setSessionUser(cookies: AstroCookies, userId: string): void {
  cookies.set(SESSION_COOKIE, sign(userId), cookieOptions);
}

/**
 * The acting identity for rule enforcement: the signed-in user if present,
 * else the anonymous visitor id (minted and set if missing).
 */
export function getActorId(cookies: AstroCookies): string {
  const userId = getSessionUserId(cookies);
  if (userId) return userId;
  const raw = cookies.get(VISITOR_COOKIE)?.value;
  const existing = raw ? unsign(raw) : null;
  if (existing) return existing;
  const visitorId = `visitor-${randomUUID()}`;
  cookies.set(VISITOR_COOKIE, sign(visitorId), cookieOptions);
  return visitorId;
}
