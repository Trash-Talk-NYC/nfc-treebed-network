import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import {
  MAX_CONFIRMATIONS,
  MAX_INFLIGHT_PIN_HASHES,
  RuleError,
  adoptBed,
  closeReport,
  confirmReport,
  escalateReport,
  fileReport,
  getBedView,
  hashPin,
  hasPhotoThisWeek,
  logPhoto,
  logTap,
  signIn,
  validateAdoptInput,
  verifyPin,
} from '../src/lib/service';

const PLATE = 'BED-HRL-0847';

let storeFile = '';
function freshStore(): LocalStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'treebed-test-'));
  storeFile = path.join(dir, 'store.json');
  return new LocalStore(storeFile);
}

function adoptInput(overrides: Partial<Parameters<typeof validateAdoptInput>[0]> = {}) {
  return {
    name: 'R. Okafor',
    username: 'r_okafor',
    pin: '4321',
    email: 'r.okafor@example.com',
    phone: '+1 555 010 1234',
    ...overrides,
  };
}

function tapEvent(id: string) {
  return {
    id,
    bedPlate: PLATE,
    eventType: 'tap' as const,
    severity: null,
    actorId: 'visitor-1',
    createdAt: new Date().toISOString(),
  };
}

let store: LocalStore;
beforeEach(() => {
  store = freshStore();
});

describe('PIN hashing', () => {
  it('round-trips a PIN and rejects a wrong one', async () => {
    const hash = await hashPin('4321');
    expect(hash).not.toContain('4321');
    expect(await verifyPin('4321', hash)).toBe(true);
    expect(await verifyPin('4322', hash)).toBe(false);
  });

  it('never stores a plaintext PIN on the user record', async () => {
    const user = await adoptBed(store, { plate: PLATE, input: adoptInput({ pin: '987654' }) });
    expect(JSON.stringify(user)).not.toContain('987654');
    expect(await verifyPin('987654', user.pinHash)).toBe(true);
  });
});

describe('two-slot cap', () => {
  it('seeds one adopter and one open slot', async () => {
    const view = await getBedView(store, PLATE);
    expect(view?.adopters.map((a) => a.user.username)).toEqual(['marisol_r']);
    expect(view?.openSlots).toBe(1);
  });

  it('allows a second adopter, then refuses a third server-side', async () => {
    await adoptBed(store, { plate: PLATE, input: adoptInput() });
    await expect(
      adoptBed(store, { plate: PLATE, input: adoptInput({ username: 'third_wheel', email: 't@example.com' }) }),
    ).rejects.toMatchObject({ code: 'slots-full' });
    const view = await getBedView(store, PLATE);
    expect(view?.openSlots).toBe(0);
  });

  it('refuses a taken username regardless of case or leading @', async () => {
    // marisol_r is the seeded adopter; one slot is still open.
    await expect(
      adoptBed(store, { plate: PLATE, input: adoptInput({ username: '@Marisol_R' }) }),
    ).rejects.toMatchObject({ code: 'username-taken' });
  });

  it('validates adopt input with explicit field errors', () => {
    const { errors } = validateAdoptInput({
      name: 'X',
      username: 'not ok!',
      pin: '12',
      email: 'nope',
      phone: '1',
    });
    expect(Object.keys(errors).sort()).toEqual(['email', 'name', 'phone', 'pin', 'username']);
  });
});

describe('one report per person per bed per day', () => {
  it('files a report with a receipt-format id', async () => {
    const report = await fileReport(store, {
      plate: PLATE,
      actorId: 'visitor-1',
      severity: 'heavy',
      photoAttached: false,
    });
    expect(report.id).toMatch(/^RPT-\d+-0847$/);
    expect(report.severity).toBe('heavy');
  });

  it('blocks a second report while one is open', async () => {
    await fileReport(store, { plate: PLATE, actorId: 'visitor-1', severity: 'light', photoAttached: false });
    await expect(
      fileReport(store, { plate: PLATE, actorId: 'visitor-2', severity: 'heavy', photoAttached: false }),
    ).rejects.toMatchObject({ code: 'open-report-exists' });
  });

  it('blocks the same person re-reporting the same NY calendar day after a clear', async () => {
    const noon = new Date('2026-08-11T16:00:00Z'); // 12:00 NY
    const evening = new Date('2026-08-11T23:00:00Z'); // 19:00 NY, same day
    await fileReport(store, { plate: PLATE, actorId: 'visitor-1', severity: 'light', photoAttached: false, now: noon });
    await closeReport(store, { plate: PLATE, actorId: 'visitor-9', now: noon });
    await expect(
      fileReport(store, { plate: PLATE, actorId: 'visitor-1', severity: 'light', photoAttached: false, now: evening }),
    ).rejects.toMatchObject({ code: 'already-reported-today' });
  });

  it('lets a different person report after a clear, and the same person the next day', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    await fileReport(store, { plate: PLATE, actorId: 'visitor-1', severity: 'light', photoAttached: false, now: noon });
    await closeReport(store, { plate: PLATE, actorId: 'visitor-9', now: noon });
    const second = await fileReport(store, {
      plate: PLATE, actorId: 'visitor-2', severity: 'heavy', photoAttached: false, now: noon,
    });
    await closeReport(store, { plate: PLATE, actorId: 'visitor-9', now: noon });
    const nextDay = new Date('2026-08-12T16:00:00Z');
    const third = await fileReport(store, {
      plate: PLATE, actorId: 'visitor-1', severity: 'light', photoAttached: false, now: nextDay,
    });
    expect(second.id).not.toBe(third.id);
  });
});

describe('confirm and escalate', () => {
  beforeEach(async () => {
    await fileReport(store, { plate: PLATE, actorId: 'visitor-1', severity: 'heavy', photoAttached: false });
  });

  it('counts each confirming neighbor once', async () => {
    await confirmReport(store, { plate: PLATE, actorId: 'visitor-2' });
    await confirmReport(store, { plate: PLATE, actorId: 'visitor-2' });
    const report = await confirmReport(store, { plate: PLATE, actorId: 'visitor-3' });
    expect(report.confirmedBy).toEqual(['visitor-2', 'visitor-3']);
  });

  it('stops storing confirmations at the cap', async () => {
    // The per-person rule bounds honest use; only a caller minting a new
    // identity per request gets here, and what it costs has to stop growing —
    // the stored array, the event beside it, and the public count alike.
    for (let i = 0; i < MAX_CONFIRMATIONS + 5; i += 1) {
      await confirmReport(store, { plate: PLATE, actorId: `visitor-${i}` });
    }
    const report = await store.getOpenReport(PLATE);
    expect(report?.confirmedBy).toHaveLength(MAX_CONFIRMATIONS);
    // No write past the cap, so no event either.
    expect(await store.getEvents(PLATE, 'confirm')).toHaveLength(MAX_CONFIRMATIONS);
  });

  it('escalates to dumping exactly once, recording the prior severity', async () => {
    const escalated = await escalateReport(store, { plate: PLATE, actorId: 'visitor-2' });
    expect(escalated.severity).toBe('dumping');
    expect(escalated.escalatedFrom).toBe('heavy');
    await expect(escalateReport(store, { plate: PLATE, actorId: 'visitor-3' })).rejects.toMatchObject({
      code: 'already-dumping',
    });
  });

  it('lets anyone close the report, recording who', async () => {
    const closed = await closeReport(store, { plate: PLATE, actorId: 'visitor-77' });
    expect(closed.closedBy).toBe('visitor-77');
    expect((await getBedView(store, PLATE))?.openReport).toBeNull();
  });
});

describe('concurrent taps', () => {
  it('opens only one report when two people file at the same moment', async () => {
    const results = await Promise.allSettled([
      fileReport(store, { plate: PLATE, actorId: 'visitor-1', severity: 'light', photoAttached: false }),
      fileReport(store, { plate: PLATE, actorId: 'visitor-2', severity: 'heavy', photoAttached: false }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')?.reason).toMatchObject({
      code: 'open-report-exists',
    });
    // A second open report would be unclosable: closeReport only ever finds the first.
    expect(await store.getReports(PLATE)).toHaveLength(1);
  });

  it('holds the two-slot cap when two people adopt the last slot at once', async () => {
    const results = await Promise.allSettled([
      adoptBed(store, { plate: PLATE, input: adoptInput({ username: 'first_one', email: 'a@example.com' }) }),
      adoptBed(store, { plate: PLATE, input: adoptInput({ username: 'second_one', email: 'b@example.com' }) }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getBedView(store, PLATE))?.openSlots).toBe(0);
  });

  it('logs one photo per week even when the button is double-submitted', async () => {
    await Promise.all([
      logPhoto(store, { plate: PLATE, actorId: 'user-marisol' }),
      logPhoto(store, { plate: PLATE, actorId: 'user-marisol' }),
    ]);
    expect(await store.getEvents(PLATE, 'photo')).toHaveLength(1);
  });
});

describe('store contract', () => {
  it('hands out detached copies, so mutating a read never reaches stored state', async () => {
    await fileReport(store, { plate: PLATE, actorId: 'visitor-1', severity: 'light', photoAttached: false });
    const read = await store.getOpenReport(PLATE);
    read!.severity = 'dumping';
    read!.confirmedBy.push('never-happened');
    const stored = await store.getOpenReport(PLATE);
    expect(stored?.severity).toBe('light');
    expect(stored?.confirmedBy).toEqual([]);
  });

  it('survives simultaneous first reads, which used to seed the file twice', async () => {
    const fresh = freshStore();
    const [bed, reports, events] = await Promise.all([
      fresh.getBed(PLATE),
      fresh.getReports(PLATE),
      fresh.getEvents(PLATE),
    ]);
    expect(bed?.plate).toBe(PLATE);
    expect(reports).toEqual([]);
    expect(events).toEqual([]);
  });

  it('keeps writes that land while the file is still being seeded', async () => {
    // The seed is a disk write of its own. A write racing it used to rename
    // the same temp file, and the loser's ENOENT took its write with it.
    const fresh = freshStore();
    const taps = Array.from({ length: 12 }, (_, i) =>
      logTap(fresh, { plate: PLATE, actorId: `visitor-${i}` }),
    );
    await Promise.all(taps);
    expect(await fresh.getEvents(PLATE, 'tap')).toHaveLength(12);
    expect(await new LocalStore(storeFile).getEvents(PLATE, 'tap')).toHaveLength(12);
  });

  it('makes a write that arrives mid-transaction wait instead of joining it', async () => {
    // The tap that lands while another request's transaction is in flight is
    // somebody else's write: it must survive that transaction rolling back.
    const elsewhere: Array<Promise<void>> = [];
    const inside = store.transaction(async (tx) => {
      await tx.appendEvent(tapEvent('event-inside'));
      elsewhere.push(store.appendEvent(tapEvent('event-outside')));
      // Real transactions yield here — the disk write is IO.
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('boom');
    });
    await expect(inside).rejects.toThrow('boom');
    await Promise.all(elsewhere);
    expect((await store.getEvents(PLATE)).map((e) => e.id)).toEqual(['event-outside']);
  });

  it('serializes two transactions that overlap a disk write', async () => {
    const order: string[] = [];
    const slow = store.transaction(async (tx) => {
      order.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await tx.appendEvent(tapEvent('event-first'));
      order.push('first-end');
    });
    const quick = store.transaction(async (tx) => {
      order.push('second-start');
      await tx.appendEvent(tapEvent('event-second'));
      order.push('second-end');
    });
    await Promise.all([slow, quick]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
    expect((await store.getEvents(PLATE)).map((e) => e.id).sort()).toEqual([
      'event-first',
      'event-second',
    ]);
  });

  it('rolls a failed transaction back instead of leaving half of it applied', async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.appendEvent(tapEvent('event-doomed'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.getEvents(PLATE)).toHaveLength(0);
  });

  it('commits a tap the same way as every other write', async () => {
    await logTap(store, { plate: PLATE, actorId: 'visitor-7' });
    const events = await store.getEvents(PLATE, 'tap');
    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe('visitor-7');
    const reread = new LocalStore(storeFile);
    expect(await reread.getEvents(PLATE, 'tap')).toHaveLength(1);
  });
});

describe('sign in', () => {
  it('accepts the seeded demo adopter and rejects a wrong PIN with one generic error', async () => {
    const user = await signIn(store, { username: '@marisol_r', pin: '1234' });
    expect(user.username).toBe('marisol_r');
    await expect(signIn(store, { username: 'marisol_r', pin: '0000' })).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
    await expect(signIn(store, { username: 'ghost', pin: '1234' })).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
  });

  it('sheds the attempts past MAX_INFLIGHT_PIN_HASHES instead of queueing their CPU', async () => {
    const attempts = Array.from({ length: MAX_INFLIGHT_PIN_HASHES + 3 }, () =>
      signIn(store, { username: 'marisol_r', pin: '1234' }).catch((err: unknown) => err),
    );
    const outcomes = await Promise.all(attempts);
    const shed = outcomes.filter((o) => o instanceof RuleError && o.code === 'busy');
    expect(shed).toHaveLength(3);
    // Whatever was admitted still got its real answer, and the shed ones freed
    // their slots again — the bound is on concurrency, not on attempts.
    expect(outcomes.filter((o) => !(o instanceof Error))).toHaveLength(MAX_INFLIGHT_PIN_HASHES);
    await expect(signIn(store, { username: 'marisol_r', pin: '1234' })).resolves.toMatchObject({
      username: 'marisol_r',
    });
  });

  it('sheds an unknown username exactly like a known one, so the refusal leaks nothing', async () => {
    const attempts = [
      ...Array.from({ length: MAX_INFLIGHT_PIN_HASHES }, () =>
        signIn(store, { username: 'marisol_r', pin: '1234' }).catch((err: unknown) => err),
      ),
      signIn(store, { username: 'ghost', pin: '1234' }).catch((err: unknown) => err),
    ];
    const outcomes = await Promise.all(attempts);
    expect(outcomes.at(-1)).toMatchObject({ code: 'busy' });
  });

  it('sheds an adoption whose PIN hash finds no slot, without touching the store', async () => {
    const held = Array.from({ length: MAX_INFLIGHT_PIN_HASHES }, () =>
      signIn(store, { username: 'marisol_r', pin: '1234' }).catch(() => null),
    );
    await expect(
      adoptBed(store, { plate: PLATE, input: adoptInput({ username: 'shed_out' }) }),
    ).rejects.toMatchObject({ code: 'busy' });
    await Promise.all(held);
    expect(await store.getUserByUsername('shed_out')).toBeNull();
  });
});

describe('weekly photo log', () => {
  it('tracks a photo event within the current NY week per user', async () => {
    const monday = new Date('2026-08-10T16:00:00Z');
    const friday = new Date('2026-08-14T16:00:00Z');
    const nextMonday = new Date('2026-08-17T16:00:00Z');
    await logPhoto(store, { plate: PLATE, actorId: 'user-a', now: monday });
    expect(await hasPhotoThisWeek(store, PLATE, 'user-a', friday)).toBe(true);
    expect(await hasPhotoThisWeek(store, PLATE, 'user-b', friday)).toBe(false);
    expect(await hasPhotoThisWeek(store, PLATE, 'user-a', nextMonday)).toBe(false);
  });
});

describe('errors', () => {
  it('uses typed RuleErrors with stable codes', async () => {
    try {
      await fileReport(store, { plate: 'BED-XX-0000', actorId: 'v', severity: 'light', photoAttached: false });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuleError);
      expect((err as RuleError).code).toBe('bed-not-found');
    }
  });
});
