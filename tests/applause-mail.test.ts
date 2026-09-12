// The applause notification's mail body. Who gets one and how often is the
// rule's business, held in tests/service.test.ts; this holds the words — the
// steward's stored language, the escaped visitor-typed bed name, and the same
// unsubscribe machinery the digest carries, because one opt-out flag covers
// every courtesy mail.

import { beforeEach, describe, expect, it } from 'vitest';
import { buildApplauseMail } from '../src/lib/applause-mail';
import { verifyUnsubscribe } from '../src/lib/unsubscribe-link';
import type { Bed, User } from '../src/lib/types';

beforeEach(() => {
  process.env.TREEBED_SESSION_SECRET ??= 'applause-mail-test-secret';
});

const BED: Bed = {
  plate: 'BED-HRL-0847',
  plantingSpaceId: '15850293',
  plantingSpaceGlobalId: null,
  treeType: { en: 'Willow oak', es: 'roble sauce' },
  treeId: '08-4211',
  bedName: null,
  tagUid: '',
  crossStreets: 'W 138 St × Adam Clayton Powell Jr Blvd',
  address: '',
  slots: 2,
  offeredSlots: 2,
  guard: null,
  treePresent: null,
  plantsPresent: null,
  plantsNote: '',
  plantingRecommended: null,
  recommendedPlantsNote: '',
  careNote: '',
  blockId: null,
  blockPosition: null,
  applauseNoticeAt: null,
  applauseNoticeDueAt: null,
  nycSyncedAt: null,
  nycMissingSince: null,
  retiredAt: null,
};

function steward(overrides: Partial<User> = {}): User {
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

describe('the applause mail', () => {
  it('speaks the steward’s stored language and links their own view', () => {
    const es = buildApplauseMail({
      user: steward({ lang: 'es' }),
      bed: BED,
      minePath: '/t/2mq2amhv/mine?lang=es',
      origin: 'https://example.org',
    });
    expect(es.subject).toBe('Alguien aplaudió tu cantero');
    expect(es.text).toContain('https://example.org/t/2mq2amhv/mine?lang=es');
    // The species prints standalone, so it takes the render-site capitalization.
    expect(es.text).toContain('Roble sauce · #15850293');

    const en = buildApplauseMail({
      user: steward(),
      bed: BED,
      minePath: '/t/2mq2amhv/mine',
      origin: 'https://example.org',
    });
    expect(en.subject).toBe('Someone applauded your tree bed');
    expect(en.to).toEqual({ email: 'seed-marisol@example.invalid', name: 'Marisol Rivera' });
  });

  it('omits the steward-view link for a bed no tag is bound to', () => {
    // The notice goes out on the scheduled run, hours after the press, and a
    // bed whose tag has since been retired has no steward view to offer. The
    // mail still says what happened — the digest omits its link the same way.
    const mail = buildApplauseMail({
      user: steward(),
      bed: BED,
      minePath: null,
      origin: 'https://example.org',
    });
    expect(mail.text).not.toContain('https://example.org/t/');
    expect(mail.html).not.toContain('/mine');
    expect(mail.text).toContain('You’ll hear about applause at most once a day');
    expect(mail.text).toContain('/digest/unsubscribe');
  });

  it('escapes the visitor-typed bed name in the HTML half', () => {
    const mail = buildApplauseMail({
      user: steward(),
      bed: { ...BED, bedName: '<b>La & "Madrina"</b>' },
      minePath: '/t/2mq2amhv/mine',
      origin: 'https://example.org',
    });
    expect(mail.html).not.toContain('<b>La');
    expect(mail.html).toContain('&lt;b&gt;La &amp; &quot;Madrina&quot;&lt;/b&gt;');
  });

  it('carries the digest’s own unsubscribe link and RFC 8058 headers', () => {
    const user = steward();
    const mail = buildApplauseMail({
      user,
      bed: BED,
      minePath: '/t/2mq2amhv/mine',
      origin: 'https://example.org',
    });
    const listUnsub = mail.headers?.['List-Unsubscribe'] ?? '';
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const url = new URL(listUnsub.slice(1, -1));
    expect(url.pathname).toBe('/digest/unsubscribe');
    expect(url.searchParams.get('u')).toBe(user.id);
    // The same signature the digest's link carries: one flag, every mail.
    expect(verifyUnsubscribe(user.id, url.searchParams.get('s') ?? '')).toBe(true);
  });
});
