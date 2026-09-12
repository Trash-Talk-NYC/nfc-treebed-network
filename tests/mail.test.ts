// The mail plane's environment decisions — sender parsing, origin trust, and
// the dev outbox. Deliberately NOTHING here touches Brevo: no key is ever
// set, so no code path can reach the network ("do not send anything").

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mailAvailable, outboxDir, publicOrigin, sendMail, senderAddress } from '../src/lib/mail';

const SAVED = { ...process.env };

beforeEach(() => {
  delete process.env.BREVO_API_KEY;
  delete process.env.TREEBED_MAIL_FROM;
  delete process.env.TREEBED_PUBLIC_ORIGIN;
  delete process.env.NODE_ENV;
  delete process.env.TREEBED_STORE;
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe('the sender address', () => {
  it('parses a bare address and a display-name form', () => {
    process.env.TREEBED_MAIL_FROM = 'beds@trashtalknyc.org';
    expect(senderAddress()).toEqual({ email: 'beds@trashtalknyc.org' });
    process.env.TREEBED_MAIL_FROM = 'Trash Talk NYC <beds@trashtalknyc.org>';
    expect(senderAddress()).toEqual({ name: 'Trash Talk NYC', email: 'beds@trashtalknyc.org' });
  });

  it('answers null for an unset or unparseable value rather than inventing one', () => {
    expect(senderAddress()).toBeNull();
    process.env.TREEBED_MAIL_FROM = 'not an address';
    expect(senderAddress()).toBeNull();
  });
});

describe('which origin links may claim', () => {
  it('always prefers the configured public origin, trailing slash trimmed', () => {
    process.env.TREEBED_PUBLIC_ORIGIN = 'https://trashtalknyc.org/';
    expect(publicOrigin('http://attacker.example')).toBe('https://trashtalknyc.org');
  });

  it('falls back to the request origin only outside production', () => {
    expect(publicOrigin('http://127.0.0.1:4321')).toBe('http://127.0.0.1:4321');
    // The deployed site's runtime signal: the publicly tappable store.
    process.env.TREEBED_STORE = 'blobs';
    expect(publicOrigin('http://attacker.example')).toBeNull();
  });
});

describe('the dev outbox', () => {
  it('writes the message as one JSON file where the e2e suite can read it', async () => {
    process.env.TREEBED_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'treebed-outbox-'));
    const result = await sendMail({
      to: { email: 'seed-marisol@example.invalid' },
      subject: 'Your sign-in link',
      html: '<p>link</p>',
      text: 'link',
    });
    expect(result).toEqual({ ok: true, transport: 'outbox' });
    const files = readdirSync(outboxDir());
    expect(files).toHaveLength(1);
    const message = JSON.parse(readFileSync(path.join(outboxDir(), files[0]!), 'utf8')) as {
      to: { email: string };
      subject: string;
    };
    expect(message.to.email).toBe('seed-marisol@example.invalid');
    expect(message.subject).toBe('Your sign-in link');
  });

  it('is unavailable — not an outbox — where production is detectable', async () => {
    process.env.TREEBED_STORE = 'blobs';
    expect(mailAvailable()).toBe(false);
    const result = await sendMail({
      to: { email: 'x@example.com' },
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
    expect(result.ok).toBe(false);
    process.env.NODE_ENV = 'production';
    delete process.env.TREEBED_STORE;
    expect(mailAvailable()).toBe(false);
  });
});
