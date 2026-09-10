// Cookie identity, two kinds:
//
//  - `tg_session`: the signed-in steward (user id). Set on sign-in / adopt.
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
 * Force the secret to resolve now, so a missing one fails the first request of
 * any route rather than waiting for the first one that happens to touch a
 * cookie. Called from the middleware, which the adapter imports lazily — so
 * this is not a boot check either; `scripts/preflight.mjs` is the only thing
 * that runs before the port is bound.
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

// ── The admin session ──────────────────────────────────────────────────
//
// The block admin page shows what no public screen may: full names, emails
// and phone numbers. "Contact details are admin-only" (design-record.md,
// constraint 5) is only true if the admin surface has a door, so every
// /admin route is gated here.
//
// The gate is one shared high-entropy key, `TREEBED_ADMIN_KEY`, held in the
// environment like the session secret — NOT a username+PIN, deliberately:
// the /auth PIN screens are a dead end nothing new may build on (AGENTS.md),
// and a short memorable secret on an un-rate-limited form is the exact trap
// they document. Comparing a long random key is constant-time and costs no
// bcrypt, so the sign-in form cannot be used to queue CPU work the way /auth
// can (`MAX_INFLIGHT_PIN_HASHES`), and there is no username to enumerate.
// What it does not have is per-IP throttling — the same platform-tier gap
// every bound in request-body.ts records as owed — which the key's entropy,
// not the form, is what covers until then.
//
// Unset in production, the admin surface answers 404 everywhere: a deploy
// that never configured a key has no admin, rather than an open one. Dev
// generates one into `.data/admin-key` beside the session secret, so the
// local admin works with nothing configured and the key never appears in a
// log or a repo.

const ADMIN_COOKIE = 'tg_admin';

/**
 * Thirty days, not the visitor cookie's year: this session opens PII, and
 * re-entering a key monthly is the cheapest re-check a shared secret gets —
 * there is no per-account revocation to lean on.
 */
const ADMIN_SESSION_SECONDS = 60 * 60 * 24 * 30;

let cachedAdminKey: string | null | undefined;

function adminKey(): string | null {
  if (cachedAdminKey !== undefined) return cachedAdminKey;
  const configured = process.env.TREEBED_ADMIN_KEY;
  if (configured) {
    cachedAdminKey = configured;
  } else if (isProduction()) {
    // No key, no admin. The routes answer 404, and nothing here invents a
    // secret that would exist only until the next restart.
    cachedAdminKey = null;
  } else {
    const dir = process.env.TREEBED_DATA_DIR ?? path.resolve('.data');
    const file = path.join(dir, 'admin-key');
    try {
      cachedAdminKey = readFileSync(file, 'utf8').trim();
    } catch {
      cachedAdminKey = randomBytes(32).toString('hex');
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, cachedAdminKey, { mode: 0o600 });
    }
  }
  return cachedAdminKey;
}

/** Whether the admin surface exists at all on this deploy. */
export function adminEnabled(): boolean {
  return adminKey() !== null;
}

/**
 * Whether a submitted key opens the admin. Constant-time on the compare; a
 * disabled admin refuses everything, and a length mismatch is decided by a
 * comparison against the key itself so the answer costs the same either way.
 */
export function verifyAdminKey(supplied: string): boolean {
  const key = adminKey();
  if (key === null || supplied.length === 0) return false;
  const expected = Buffer.from(key);
  const given = Buffer.from(supplied);
  if (given.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(given, expected);
}

export function setAdminSession(cookies: AstroCookies): void {
  cookies.set(ADMIN_COOKIE, sign(`admin.${Date.now()}`), {
    ...cookieOptions,
    maxAge: ADMIN_SESSION_SECONDS,
  });
}

/** Whether this request carries a live admin session. */
export function isAdminSession(cookies: AstroCookies): boolean {
  if (!adminEnabled()) return false;
  const raw = cookies.get(ADMIN_COOKIE)?.value;
  const value = raw ? unsign(raw) : null;
  if (value === null || !value.startsWith('admin.')) return false;
  const issuedAt = Number(value.slice('admin.'.length));
  // The cookie's own maxAge already expires it client-side; this is the
  // server-side half, so a replayed cookie ages out too.
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < ADMIN_SESSION_SECONDS * 1000;
}

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
  const existing = getExistingActorId(cookies);
  if (existing) return existing;
  const visitorId = `visitor-${randomUUID()}`;
  cookies.set(VISITOR_COOKIE, sign(visitorId), cookieOptions);
  return visitorId;
}

/**
 * The acting identity the caller already had, or null — nothing minted.
 *
 * For the rules that are only worth anything per person: minting an identity
 * on the write itself hands a caller that discards cookies a fresh one every
 * request, so "once per person" bounds nothing at all. A real visitor always
 * has one by the time they can press a button, because the plaque GET they
 * came through minted it.
 */
export function getExistingActorId(cookies: AstroCookies): string | null {
  const userId = getSessionUserId(cookies);
  if (userId) return userId;
  const raw = cookies.get(VISITOR_COOKIE)?.value;
  return raw ? unsign(raw) : null;
}
