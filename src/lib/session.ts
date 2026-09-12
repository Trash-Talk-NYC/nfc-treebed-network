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

import { devFallbackSecret } from './signing-secret';

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
  // Local-dev fallback, owned by signing-secret.ts so there is one place that
  // decides where the dev secret lives and one copy of it: this module and the
  // no-`import.meta` resolver the scheduled function uses must key the same
  // MACs, and two independent generators could race the file and disagree.
  secret = devFallbackSecret();
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

/**
 * What a signature is FOR, mixed into the MAC so one cookie's value can never
 * be replayed as another's.
 *
 * `ACTOR` is the empty label, and stays empty on purpose: it is what
 * `tg_session` and `tg_visitor` have always been signed with, and the live
 * pilot holds year-long steward cookies signed that way. The two share a
 * domain by design — `getExistingActorId` accepts either as the acting
 * identity — so there is nothing between them to separate.
 *
 * `ADMIN` is its own label, which is the separation that matters: the admin
 * gate no longer rests on no other signed value ever starting with `admin.`,
 * because a MAC made for an actor id does not verify as an admin one.
 */
const PURPOSE = { ACTOR: '', ADMIN: 'admin' } as const;
type Purpose = (typeof PURPOSE)[keyof typeof PURPOSE];

function macInput(value: string, purpose: Purpose): string {
  return purpose === '' ? value : `${purpose}:${value}`;
}

function sign(value: string, purpose: Purpose): string {
  const mac = createHmac('sha256', getSecret()).update(macInput(value, purpose)).digest('base64url');
  return `${value}.${mac}`;
}

function unsign(signed: string, purpose: Purpose): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const mac = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(
    createHmac('sha256', getSecret()).update(macInput(value, purpose)).digest('base64url'),
  );
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
// environment like the session secret — NOT a typed account secret,
// deliberately: a short memorable secret on an un-rate-limited form is the
// trap the retired PIN screens documented, and the steward flow's emailed
// link is not for the admin either (the admin is a role, not a steward's
// mailbox). Comparing a long random key is constant-time, costs no hashing,
// and offers no username to enumerate. What it does not have is per-IP
// throttling — the same platform-tier gap every bound in request-body.ts
// records as owed — which the key's entropy, not the form, is what covers
// until then.
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
  cookies.set(ADMIN_COOKIE, sign(`admin.${Date.now()}`, PURPOSE.ADMIN), {
    ...cookieOptions,
    maxAge: ADMIN_SESSION_SECONDS,
  });
}

/**
 * Close the admin session on this device.
 *
 * The counterpart the 30-day PII cookie has to have: the captain works from
 * a phone on the sidewalk and hands it over to write a neighbour in, and the
 * only other ways out are clearing site data or rotating `TREEBED_ADMIN_KEY`,
 * which signs out every device at once.
 */
export function clearAdminSession(cookies: AstroCookies): void {
  cookies.delete(ADMIN_COOKIE, { path: cookieOptions.path });
}

/** Whether this request carries a live admin session. */
export function isAdminSession(cookies: AstroCookies): boolean {
  if (!adminEnabled()) return false;
  const raw = cookies.get(ADMIN_COOKIE)?.value;
  const value = raw ? unsign(raw, PURPOSE.ADMIN) : null;
  if (value === null || !value.startsWith('admin.')) return false;
  const issuedAt = Number(value.slice('admin.'.length));
  // The cookie's own maxAge already expires it client-side; this is the
  // server-side half, so a replayed cookie ages out too.
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < ADMIN_SESSION_SECONDS * 1000;
}

export function getSessionUserId(cookies: AstroCookies): string | null {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  return raw ? unsign(raw, PURPOSE.ACTOR) : null;
}

export function setSessionUser(cookies: AstroCookies, userId: string): void {
  cookies.set(SESSION_COOKIE, sign(userId, PURPOSE.ACTOR), cookieOptions);
}

/**
 * The acting identity for rule enforcement: the signed-in user if present,
 * else the anonymous visitor id (minted and set if missing).
 */
export function getActorId(cookies: AstroCookies): string {
  const existing = getExistingActorId(cookies);
  if (existing) return existing;
  const visitorId = `visitor-${randomUUID()}`;
  cookies.set(VISITOR_COOKIE, sign(visitorId, PURPOSE.ACTOR), cookieOptions);
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
  return raw ? unsign(raw, PURPOSE.ACTOR) : null;
}
