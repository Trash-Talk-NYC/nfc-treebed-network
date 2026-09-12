// The steward digest: who is due, what goes out, and that a run can never
// double-send. The send is injected — nothing here has a transport, let
// alone a real one, per the captain's "do not send anything".

import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import {
  buildDigestMail,
  cadencePeriodMs,
  digestDue,
  runApplauseNotices,
  runDigest,
  unsubscribePath,
  verifyUnsubscribe,
} from '../src/lib/digest';
import { reportProblem, sendApplause } from '../src/lib/service';
import type { MailMessage } from '../src/lib/mail';
import type { User } from '../src/lib/types';

const PLATE = 'BED-HRL-0847';
const NOW = new Date('2026-09-11T11:00:00Z');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let store: LocalStore;
beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'treebed-digest-'));
  store = new LocalStore(path.join(dir, 'store.json'));
  // These tests exercise a running digest, so the network has one switched
  // on — the DEFAULT is off, which the last describe holds to.
  process.env.TREEBED_SESSION_SECRET ??= 'digest-test-secret';
});

async function weeklyCadence(): Promise<void> {
  await store.updateNetworkSettings({ digestCadence: 'weekly' });
}

function seededMarisol(overrides: Partial<User> = {}): User {
  return {
    id: 'user-marisol',
    firstName: 'Marisol',
    lastName: 'Rivera',
    username: 'marisol_r',
    hasSignInRoute: true,
    recordHeldOnBehalf: false,
    email: 'seed-marisol@example.invalid',
    phone: '',
    lang: 'en',
    digestOptedOut: false,
    digestLastSentAt: null,
    points: 0,
    streakWeeks: 0,
    createdAt: '2026-05-02T14:00:00.000Z',
    ...overrides,
  };
}

/** A send that keeps what it was handed instead of delivering it. */
function capture(): { sent: MailMessage[]; send: (m: MailMessage) => Promise<{ ok: true; transport: 'outbox' }> } {
  const sent: MailMessage[] = [];
  return {
    sent,
    send: async (m: MailMessage) => {
      sent.push(m);
      return { ok: true, transport: 'outbox' };
    },
  };
}

describe('who is due', () => {
  it('never anyone while the cadence is off — the shipped default', () => {
    expect(cadencePeriodMs('off')).toBeNull();
    expect(digestDue(seededMarisol(), 'off', NOW)).toBe(false);
  });

  it('is due on first contact, then again only after the period', () => {
    expect(digestDue(seededMarisol(), 'weekly', NOW)).toBe(true);
    const justSent = seededMarisol({ digestLastSentAt: NOW.toISOString() });
    expect(digestDue(justSent, 'weekly', NOW)).toBe(false);
    const nearlyAWeek = seededMarisol({
      // 30 minutes short of a week: inside the slack, so a daily runner
      // does not drift the send a day later every period.
      digestLastSentAt: new Date(NOW.getTime() - WEEK_MS + 30 * 60 * 1000).toISOString(),
    });
    expect(digestDue(nearlyAWeek, 'weekly', NOW)).toBe(true);
    const midWeek = seededMarisol({
      digestLastSentAt: new Date(NOW.getTime() - WEEK_MS / 2).toISOString(),
    });
    expect(digestDue(midWeek, 'weekly', NOW)).toBe(false);
  });

  it('never emails a steward without an email, or one who unsubscribed', () => {
    expect(digestDue(seededMarisol({ email: '' }), 'weekly', NOW)).toBe(false);
    expect(digestDue(seededMarisol({ email: '  ' }), 'weekly', NOW)).toBe(false);
    expect(digestDue(seededMarisol({ digestOptedOut: true }), 'weekly', NOW)).toBe(false);
  });

  it('spaces the longer cadences accordingly', () => {
    const twoWeeksAgo = seededMarisol({
      digestLastSentAt: new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(digestDue(twoWeeksAgo, 'biweekly', NOW)).toBe(true);
    expect(digestDue(twoWeeksAgo, 'monthly', NOW)).toBe(false);
  });
});

describe('one run', () => {
  it('sends one digest per due steward and claims before sending', async () => {
    await weeklyCadence();
    const { sent, send } = capture();
    const first = await runDigest(store, { origin: 'https://example.org', now: NOW, send });
    expect(first).toMatchObject({ cadence: 'weekly', sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to.email).toBe('seed-marisol@example.invalid');
    // The claim is durable: a second run the same day sends nothing.
    const again = await runDigest(store, { origin: 'https://example.org', now: NOW, send });
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('skips a steward with no active bed even when their clock says due', async () => {
    await weeklyCadence();
    // A user with an email and no adoption — released, or never a steward.
    await store.createUser(
      seededMarisol({ id: 'user-bedless', username: 'bedless', email: 'b@example.com' }),
    );
    const { sent, send } = capture();
    const run = await runDigest(store, { origin: 'https://example.org', now: NOW, send });
    expect(run.sent).toBe(1);
    expect(sent.map((m) => m.to.email)).toEqual(['seed-marisol@example.invalid']);
  });

  it('opens no transaction for a steward with nothing to send', async () => {
    await weeklyCadence();
    await store.createUser(
      seededMarisol({ id: 'user-bedless', username: 'bedless', email: 'b@example.com' }),
    );
    // Such a steward is never claimed, so they stay due for every run from
    // here on — and on the Blobs backend a transaction that writes nothing
    // still commits a revision, so the run must not open one for them.
    let transactions = 0;
    const counted = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return (...args: Parameters<typeof store.transaction>) => {
            transactions += 1;
            return store.transaction(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const { sent, send } = capture();
    await runDigest(counted, { origin: 'https://example.org', now: NOW, send });
    expect(sent).toHaveLength(1);
    expect(transactions).toBe(1);
  });

  it('does nothing at all on the shipped default, which is off', async () => {
    const { sent, send } = capture();
    const run = await runDigest(store, { origin: 'https://example.org', now: NOW, send });
    expect(run).toMatchObject({ cadence: 'off', sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe('what the mail says', () => {
  it('speaks the steward’s stored language and carries the bed, the report and the applause', async () => {
    await weeklyCadence();
    await store.transaction(async (tx) => {
      const user = await tx.getUser('user-marisol');
      await tx.updateUser({ ...user!, lang: 'es' });
    });
    await reportProblem(store, {
      plate: PLATE,
      actorId: 'visitor-1',
      categories: ['litter'],
      note: '',
      photoAttached: false,
      now: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    await sendApplause(store, {
      plate: PLATE,
      actorId: 'visitor-2',
      now: new Date(NOW.getTime() - 30 * 60 * 1000),
    });
    const { sent, send } = capture();
    await runDigest(store, { origin: 'https://example.org', now: NOW, send });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.subject).toBe('Cómo va tu cantero');
    // The seed's Spanish species name, in the checked-in table's own casing.
    expect(mail.text.toLowerCase()).toContain('roble sauce');
    expect(mail.text).toContain('Basura');
    expect(mail.text).toContain('Aplausos desde tu último resumen: 1');
    // The species prints standalone here, so it takes the render-site
    // capitalization ("Roble sauce", not the stored mid-sentence lowercase).
    expect(mail.text).toContain('Roble sauce');
    // The demo tag is bound to this bed, so the mail links the steward's view.
    expect(mail.text).toContain('https://example.org/t/2mq2amhv/mine?lang=es');
    // And the unsubscribe link, signed — in the body and in the RFC 8058
    // headers, so mail clients surface their own control.
    expect(mail.text).toMatch(/\/digest\/unsubscribe\?u=user-marisol&s=[A-Za-z0-9_-]+/);
    expect(mail.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/example\.org\/digest\/unsubscribe\?u=user-marisol&s=[A-Za-z0-9_-]+&lang=es>$/);
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('escapes the visitor-typed bed name in the HTML half', async () => {
    const content = {
      user: seededMarisol(),
      beds: [
        {
          bed: {
            ...(await store.getBed(PLATE))!,
            bedName: '<b>“La Madrina”</b>',
          },
          openReport: null,
          applause: 0,
          minePath: null,
        },
      ],
    };
    const mail = buildDigestMail(content, 'https://example.org');
    expect(mail.html).not.toContain('<b>“La Madrina”</b>');
    expect(mail.html).toContain('&lt;b&gt;');
  });
});

describe('the unsubscribe link', () => {
  it('round-trips its signature and refuses a tampered one', () => {
    const user = seededMarisol();
    const link = unsubscribePath(user);
    const params = new URLSearchParams(link.split('?')[1]);
    expect(params.get('u')).toBe(user.id);
    expect(verifyUnsubscribe(user.id, params.get('s')!)).toBe(true);
    expect(verifyUnsubscribe('user-somebody-else', params.get('s')!)).toBe(false);
    expect(verifyUnsubscribe(user.id, 'forged')).toBe(false);
  });
});

describe('the applause notices the tap flow queued', () => {
  it('delivers them on the daily clock even while the digest cadence is off', async () => {
    // The shipped default: no digest at all. The captain's "i realize when
    // applause is sent i dont get emailed" is a different mail, so it still
    // goes out.
    expect((await store.getNetworkSettings()).digestCadence).toBe('off');
    await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: NOW });
    const { sent, send } = capture();
    const run = await runApplauseNotices(store, { origin: 'https://example.org', send });
    expect(run).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to.email).toBe('seed-marisol@example.invalid');
    expect(sent[0]!.subject).toBe('Someone applauded your tree bed');
    // The demo tag is bound to this bed, so the mail links the steward's view.
    expect(sent[0]!.text).toContain('https://example.org/t/2mq2amhv/mine');
    // Claim-then-send: the queue is empty, so a rerun mails nothing.
    const again = await runApplauseNotices(store, { origin: 'https://example.org', send });
    expect(again).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });

  it('mails once per bed per NY day however many people applaud', async () => {
    await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: NOW });
    await sendApplause(store, {
      plate: PLATE,
      actorId: 'visitor-2',
      now: new Date(NOW.getTime() + 60 * 60 * 1000),
    });
    const { sent, send } = capture();
    await runApplauseNotices(store, { origin: 'https://example.org', send });
    expect(sent).toHaveLength(1);
  });

  it('mails nobody without an email, and hands that day back', async () => {
    const marisol = (await store.getUser('user-marisol'))!;
    await store.updateUser({ ...marisol, email: '' });
    await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: NOW });
    const { sent, send } = capture();
    const run = await runApplauseNotices(store, { origin: 'https://example.org', send });
    expect(run).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
    // Nobody was mailable, so the day is not spent: an email added later that
    // day still earns the notice.
    const bed = (await store.getBed(PLATE))!;
    expect(bed.applauseNoticeAt).toBeNull();
    expect(bed.applauseNoticeDueAt).toBeNull();
  });

  it('forfeits a notice whose send fails rather than queueing it again', async () => {
    await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: NOW });
    const run = await runApplauseNotices(store, {
      origin: 'https://example.org',
      send: async () => ({ ok: false as const, detail: 'brevo said no' }),
    });
    expect(run).toEqual({ sent: 0, failed: 1 });
    expect(await store.getBedsWithApplauseNoticeDue()).toHaveLength(0);
  });
});
