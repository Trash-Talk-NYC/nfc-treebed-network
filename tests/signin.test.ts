// The sign-in link's rules: mint, verify, burn — and the two rate caps.
// Same seam as every rule test: a real LocalStore on a temp file, service.ts
// in front of it. The mail plane is not in the picture here; what these hold
// is the token lifecycle the captain's decision demands (single use, minutes
// of life, bound to the bed) and that the store never sees a raw token.

import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import {
  MAX_SIGNIN_REQUESTS_PER_BED,
  MAX_SIGNIN_REQUESTS_PER_EMAIL,
  SIGNIN_TOKEN_TTL_MS,
  consumeSignInToken,
  requestSignInLink,
} from '../src/lib/service';

const PLATE = 'BED-HRL-0847';
const OTHER_PLATE = 'BED-WH-1711';
const EMAIL = 'seed-marisol@example.invalid';

let storeFile = '';
let store: LocalStore;
beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'treebed-signin-'));
  storeFile = path.join(dir, 'store.json');
  store = new LocalStore(storeFile);
});

async function mintedToken(now = new Date()): Promise<string> {
  const outcome = await requestSignInLink(store, { plate: PLATE, email: EMAIL, now });
  if (outcome.kind !== 'sent') throw new Error(`expected a token, got ${outcome.kind}`);
  return outcome.token;
}

describe('minting a sign-in link', () => {
  it('hands the steward and a token for a known email, case-insensitively', async () => {
    const outcome = await requestSignInLink(store, {
      plate: PLATE,
      email: 'Seed-Marisol@Example.INVALID',
    });
    expect(outcome.kind).toBe('sent');
    if (outcome.kind !== 'sent') return;
    expect(outcome.user.username).toBe('marisol_r');
    expect(outcome.token.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
  });

  it('answers an unknown email with the same shape and no stored token', async () => {
    const outcome = await requestSignInLink(store, { plate: PLATE, email: 'ghost@example.com' });
    expect(outcome).toEqual({ kind: 'unknown-email' });
  });

  it('never stores or logs the raw token — only its hash reaches the store', async () => {
    const token = await mintedToken();
    const stored = readFileSync(storeFile, 'utf8');
    expect(stored).not.toContain(token);
    // The row exists, as a hash with an expiry.
    const data = JSON.parse(stored) as {
      signInTokens: Array<{ tokenHash: string; userId: string; bedPlate: string }>;
    };
    expect(data.signInTokens).toHaveLength(1);
    expect(data.signInTokens[0]!.tokenHash).not.toBe(token);
    expect(data.signInTokens[0]!.bedPlate).toBe(PLATE);
  });
});

describe('opening the link', () => {
  it('signs the steward in exactly once — the second open finds nothing', async () => {
    const token = await mintedToken();
    const user = await consumeSignInToken(store, { plate: PLATE, token });
    expect(user.username).toBe('marisol_r');
    await expect(consumeSignInToken(store, { plate: PLATE, token })).rejects.toMatchObject({
      code: 'invalid-token',
    });
  });

  it('refuses an expired link, with the same answer as a fake one', async () => {
    const minted = new Date('2026-09-11T12:00:00Z');
    const token = await mintedToken(minted);
    const late = new Date(minted.getTime() + SIGNIN_TOKEN_TTL_MS + 1000);
    await expect(
      consumeSignInToken(store, { plate: PLATE, token, now: late }),
    ).rejects.toMatchObject({ code: 'invalid-token' });
    await expect(
      consumeSignInToken(store, { plate: PLATE, token: 'not-a-token' }),
    ).rejects.toMatchObject({ code: 'invalid-token' });
  });

  it('still works right at the edge of its fifteen minutes', async () => {
    const minted = new Date('2026-09-11T12:00:00Z');
    const token = await mintedToken(minted);
    const justInTime = new Date(minted.getTime() + SIGNIN_TOKEN_TTL_MS - 1000);
    const user = await consumeSignInToken(store, { plate: PLATE, token, now: justInTime });
    expect(user.username).toBe('marisol_r');
  });

  it('refuses a link opened at a different bed WITHOUT burning it', async () => {
    const token = await mintedToken();
    await expect(
      consumeSignInToken(store, { plate: OTHER_PLATE, token }),
    ).rejects.toMatchObject({ code: 'invalid-token' });
    // The rightful link still works: whoever holds it is its recipient, and
    // a wrong door must not spend their sign-in.
    const user = await consumeSignInToken(store, { plate: PLATE, token });
    expect(user.username).toBe('marisol_r');
  });
});

describe('the rate limits, counted in the store', () => {
  it('caps requests per email inside the window, for unknown addresses too', async () => {
    for (let i = 0; i < MAX_SIGNIN_REQUESTS_PER_EMAIL; i += 1) {
      await requestSignInLink(store, { plate: PLATE, email: 'ghost@example.com' });
    }
    // The refusal is identical whether or not the address is anybody's —
    // the ledger is hashed emails, checked before any user lookup.
    await expect(
      requestSignInLink(store, { plate: PLATE, email: 'ghost@example.com' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
    await expect(
      requestSignInLink(store, { plate: PLATE, email: 'GHOST@example.com' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
    // A different email is a different allowance.
    const other = await requestSignInLink(store, { plate: PLATE, email: 'other@example.com' });
    expect(other.kind).toBe('unknown-email');
  });

  it('caps requests per bed across every email', async () => {
    for (let i = 0; i < MAX_SIGNIN_REQUESTS_PER_BED; i += 1) {
      await requestSignInLink(store, { plate: PLATE, email: `probe-${i}@example.com` });
    }
    await expect(
      requestSignInLink(store, { plate: PLATE, email: 'fresh@example.com' }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
    // Another bed's auth screen is another allowance.
    const other = await requestSignInLink(store, {
      plate: OTHER_PLATE,
      email: 'fresh@example.com',
    });
    expect(other.kind).toBe('unknown-email');
  });

  it('lets the window slide: an hour later the same email may ask again', async () => {
    const noon = new Date('2026-09-11T12:00:00Z');
    for (let i = 0; i < MAX_SIGNIN_REQUESTS_PER_EMAIL; i += 1) {
      await requestSignInLink(store, { plate: PLATE, email: EMAIL, now: noon });
    }
    await expect(
      requestSignInLink(store, { plate: PLATE, email: EMAIL, now: noon }),
    ).rejects.toMatchObject({ code: 'rate-limited' });
    const later = new Date(noon.getTime() + 61 * 60 * 1000);
    const outcome = await requestSignInLink(store, { plate: PLATE, email: EMAIL, now: later });
    expect(outcome.kind).toBe('sent');
  });

  it('keeps the ledger and the token table pruned as it goes', async () => {
    const noon = new Date('2026-09-11T12:00:00Z');
    await requestSignInLink(store, { plate: PLATE, email: EMAIL, now: noon });
    const nextDay = new Date(noon.getTime() + 24 * 60 * 60 * 1000);
    await requestSignInLink(store, { plate: PLATE, email: EMAIL, now: nextDay });
    const data = JSON.parse(readFileSync(storeFile, 'utf8')) as {
      signInTokens: unknown[];
      signInRequests: unknown[];
    };
    // Yesterday's request row and yesterday's expired token are both gone —
    // neither table grows with lifetime traffic.
    expect(data.signInRequests).toHaveLength(1);
    expect(data.signInTokens).toHaveLength(1);
  });
});
