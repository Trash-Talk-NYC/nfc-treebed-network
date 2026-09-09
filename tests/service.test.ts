import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import { MAX_NOTE_CHARS } from '../src/lib/problem';
import {
  MAX_CONFIRMATIONS,
  MAX_INFLIGHT_PIN_HASHES,
  RuleError,
  adoptBed,
  closeReport,
  engravedStewards,
  escalateReport,
  getBedView,
  hashPin,
  hasPhotoThisWeek,
  logPhoto,
  deriveUsername,
  logTap,
  reportProblem,
  sendApplause,
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
    firstName: 'Rita',
    lastName: 'Okafor',
    email: 'r.okafor@example.com',
    phone: '+1 555 010 1234',
    ...overrides,
  };
}

/** The care screen's submission, with only what a test cares about spelled out. */
function careInput(overrides: Partial<Parameters<typeof reportProblem>[1]> = {}) {
  return {
    plate: PLATE,
    actorId: 'visitor-1',
    category: 'litter' as const,
    note: '',
    photoAttached: false,
    ...overrides,
  };
}

function tapEvent(id: string) {
  return {
    id,
    bedPlate: PLATE,
    eventType: 'tap' as const,
    severity: null,
    category: null,
    note: '',
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

  it('stores no secret at all for a steward who adopts at the tag', async () => {
    // The captain chose passwordless and ordered the field dropped: a
    // forgotten secret is permanent lockout, and a cloned plaque on a public
    // repo is a reusable secret to harvest. The form collects none, so there
    // is none to store — and `hasSignInRoute` says so plainly, rather than
    // leaving a null hash for somebody to read as an accident.
    const user = await adoptBed(store, { plate: PLATE, input: adoptInput() });
    expect(user.pinHash).toBeNull();
    expect(user.hasSignInRoute).toBe(false);
    // Not the pen-and-paper case: they signed themselves up and gave an email.
    expect(user.recordHeldOnBehalf).toBe(false);
  });

  it('refuses to sign in a steward who has no secret, at the same price as any other miss', async () => {
    await adoptBed(store, { plate: PLATE, input: adoptInput() });
    await expect(signIn(store, { username: 'rita_o', pin: '1234' })).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
  });
});

describe('the handle, derived rather than typed', () => {
  it('takes the first name and the last initial, the way the seed does', async () => {
    // Marisol Rivera → @marisol_r, printed above M. R. — the shape the captain
    // has been looking at across the whole review.
    expect(deriveUsername('Marisol', 'Rivera', () => false)).toBe('marisol_r');
    expect(deriveUsername('Rita', 'Okafor', () => false)).toBe('rita_o');
  });

  it('folds accents rather than dropping the letters under them', () => {
    // A third of the names on this block carry one, and `jos_g` would be a
    // worse handle than `jose_g` for the same person.
    expect(deriveUsername('José', 'Güell', () => false)).toBe('jose_g');
    expect(deriveUsername('Ñico', 'Peña', () => false)).toBe('nico_p');
  });

  it('still produces a handle for a name with nothing in the alphabet', () => {
    expect(deriveUsername('王', '小', () => false)).toBe('steward');
  });

  it('walks past a handle somebody already holds', () => {
    const taken = new Set(['marisol_r', 'marisol_r2']);
    expect(deriveUsername('Marisol', 'Rivera', (c) => taken.has(c))).toBe('marisol_r3');
  });

  it('hands two neighbours with the same name different handles', async () => {
    const first = await adoptBed(store, { plate: PLATE, input: adoptInput({ firstName: 'Marisol', lastName: 'Rivera' }) });
    // marisol_r is the seeded steward, so the new one cannot have it.
    expect(first.username).toBe('marisol_r2');
  });
});

describe('two-slot cap', () => {
  it('seeds one steward and one open slot', async () => {
    const view = await getBedView(store, PLATE);
    expect(view?.stewards.map((s) => s.user.username)).toEqual(['marisol_r']);
    expect(view?.openSlots).toBe(1);
  });

  it('drops a steward who asked not to be named from the public list only', async () => {
    const view = await getBedView(store, PLATE);
    const stewards = view!.stewards;
    expect(engravedStewards(stewards)).toEqual(stewards);

    const hidden = stewards.map((s) => ({ ...s, adoption: { ...s.adoption, displayNameHidden: true } }));
    expect(engravedStewards(hidden)).toEqual([]);
    // The bed is still adopted: what a screen keys "stewarded" on is the
    // adoption count, never how many rows it ends up rendering.
    expect(hidden.length).toBe(1);
  });

  it('allows a second steward, then refuses a third server-side', async () => {
    await adoptBed(store, { plate: PLATE, input: adoptInput() });
    await expect(
      adoptBed(store, { plate: PLATE, input: adoptInput({ firstName: 'Tam', email: 't@example.com' }) }),
    ).rejects.toMatchObject({ code: 'slots-full' });
    const view = await getBedView(store, PLATE);
    expect(view?.openSlots).toBe(0);
  });

  it('validates adopt input with explicit field error codes', () => {
    const { errors } = validateAdoptInput({
      firstName: '',
      lastName: '',
      email: 'nope',
      phone: '1',
    });
    // Codes, not sentences: every screen renders in the visitor's language, so
    // a message from the rules layer would be the one string that could not.
    expect(errors).toEqual({
      firstName: 'firstName',
      lastName: 'lastName',
      email: 'email',
      phone: 'phone',
    });
  });

  it('accepts a missing phone, which the captain asked for, and still checks a given one', () => {
    expect(validateAdoptInput(adoptInput({ phone: '' })).errors).toEqual({});
    expect(validateAdoptInput(adoptInput({ phone: 'nope' })).errors).toEqual({ phone: 'phone' });
  });
});

describe('what SEND IT is worth', () => {
  it('files a report with a receipt-format id and the category the visitor picked', async () => {
    const outcome = await reportProblem(store, careInput({ category: 'thirsty' }));
    expect(outcome.kind).toBe('filed');
    expect(outcome.report?.id).toMatch(/^RPT-\d+-0847$/);
    expect(outcome.report?.category).toBe('thirsty');
    // Nothing on the street sets severity: the problem screen asks what is
    // wrong, not how bad.
    expect(outcome.report?.severity).toBeNull();
  });

  it('keeps the sentence behind "something else", capped', async () => {
    const long = 'x'.repeat(MAX_NOTE_CHARS + 50);
    const outcome = await reportProblem(store, careInput({ category: 'other', note: long }));
    expect(outcome.report?.note).toHaveLength(MAX_NOTE_CHARS);
  });

  it("adds a second reporter's weight to the open report instead of opening a duplicate", async () => {
    // Two open reports on one bed is unrecoverable through the UI: closeReport
    // only ever finds the first. The approved flow has no confirm screen, so
    // the same press counts them on the report that is already open.
    await reportProblem(store, careInput({ actorId: 'visitor-1' }));
    const second = await reportProblem(store, careInput({ actorId: 'visitor-2' }));
    expect(second.kind).toBe('added-weight');
    expect(second.report?.confirmedBy).toEqual(['visitor-2']);
    expect(await store.getReports(PLATE)).toHaveLength(1);
  });

  it("keeps what the second neighbour said, and their photo", async () => {
    // The screen thanks them either way, so what they picked and typed has to
    // survive somewhere a steward reads it — the `confirm` event.
    await reportProblem(store, careInput({ actorId: 'visitor-1', category: 'litter', note: '' }));
    const second = await reportProblem(
      store,
      careInput({
        actorId: 'visitor-2',
        category: 'guard',
        note: 'la reja está doblada y hay un clavo suelto',
        photoAttached: true,
      }),
    );
    expect(second.kind).toBe('added-weight');
    const [confirm] = await store.getEvents(PLATE, 'confirm');
    expect(confirm?.category).toBe('guard');
    expect(confirm?.note).toBe('la reja está doblada y hay un clavo suelto');
    // A photo attached to the second press is still a photo of the bed's open
    // problem.
    expect((await store.getOpenReport(PLATE))?.photoAttached).toBe(true);
  });

  it('records the category and the note on the report event too', async () => {
    await reportProblem(store, careInput({ category: 'thirsty', note: 'la tierra está seca' }));
    const [filed] = await store.getEvents(PLATE, 'report');
    expect(filed?.category).toBe('thirsty');
    expect(filed?.note).toBe('la tierra está seca');
  });

  it('counts each neighbour once, and stops at the cap', async () => {
    await reportProblem(store, careInput({ actorId: 'visitor-1' }));
    await reportProblem(store, careInput({ actorId: 'visitor-2' }));
    const repeat = await reportProblem(store, careInput({ actorId: 'visitor-2' }));
    expect(repeat.kind).toBe('already-said');
    expect(repeat.report?.confirmedBy).toEqual(['visitor-2']);

    // The per-person rule bounds honest use; only a caller minting a new
    // identity per request gets here, and what it costs has to stop growing —
    // the stored array and the event beside it alike.
    for (let i = 0; i < MAX_CONFIRMATIONS + 5; i += 1) {
      await reportProblem(store, careInput({ actorId: `weight-${i}` }));
    }
    const open = await store.getOpenReport(PLATE);
    expect(open?.confirmedBy).toHaveLength(MAX_CONFIRMATIONS);
    expect(await store.getEvents(PLATE, 'confirm')).toHaveLength(MAX_CONFIRMATIONS);
  });

  it('writes nothing when the same person sends again the same NY calendar day', async () => {
    const noon = new Date('2026-08-11T16:00:00Z'); // 12:00 NY
    const evening = new Date('2026-08-11T23:00:00Z'); // 19:00 NY, same day
    await reportProblem(store, careInput({ actorId: 'visitor-1', now: noon }));
    await closeReport(store, { plate: PLATE, actorId: 'visitor-9', now: noon });
    const again = await reportProblem(store, careInput({ actorId: 'visitor-1', now: evening }));
    // No rule is shown to somebody standing at a tree — the screen thanks them
    // either way. The record is where it stays legible that nothing was written.
    expect(again).toEqual({ kind: 'already-said', report: null });
    expect(await store.getReports(PLATE)).toHaveLength(1);
  });

  it('lets a different person report after a clear, and the same person the next day', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    await reportProblem(store, careInput({ actorId: 'visitor-1', now: noon }));
    await closeReport(store, { plate: PLATE, actorId: 'visitor-9', now: noon });
    const second = await reportProblem(store, careInput({ actorId: 'visitor-2', now: noon }));
    await closeReport(store, { plate: PLATE, actorId: 'visitor-9', now: noon });
    const nextDay = new Date('2026-08-12T16:00:00Z');
    const third = await reportProblem(store, careInput({ actorId: 'visitor-1', now: nextDay }));
    expect(second.report?.id).not.toBe(third.report?.id);
  });
});

describe('applause', () => {
  it('counts one per person per bed per NY day', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    const evening = new Date('2026-08-11T23:00:00Z');
    const nextDay = new Date('2026-08-12T16:00:00Z');
    expect(await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: noon })).toEqual({
      counted: true,
    });
    // `events` is append-only with nothing pruning it, so a button anybody can
    // press without signing in has to stop costing something at some point.
    expect(await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: evening })).toEqual({
      counted: false,
    });
    expect(await sendApplause(store, { plate: PLATE, actorId: 'visitor-2', now: noon })).toEqual({
      counted: true,
    });
    expect(await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: nextDay })).toEqual({
      counted: true,
    });
    expect(await store.getEvents(PLATE, 'applause')).toHaveLength(3);
  });
});

describe('escalate and clear', () => {
  // No route reaches `escalateReport` in the shipped tap flow — the approved
  // screens have no escalate button — but the capability is intact in the
  // service layer, exactly as `closeReport` is for anonymous clear. See
  // AGENTS.md.
  beforeEach(async () => {
    await reportProblem(store, careInput({ actorId: 'visitor-1' }));
  });

  it('escalates to dumping exactly once, recording the prior severity', async () => {
    const escalated = await escalateReport(store, { plate: PLATE, actorId: 'visitor-2' });
    expect(escalated.severity).toBe('dumping');
    // Nothing set a severity on the street, so there was none to escalate from.
    expect(escalated.escalatedFrom).toBeNull();
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
    const results = await Promise.all([
      reportProblem(store, careInput({ actorId: 'visitor-1' })),
      reportProblem(store, careInput({ actorId: 'visitor-2' })),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(['added-weight', 'filed']);
    // A second open report would be unclosable: closeReport only ever finds the first.
    expect(await store.getReports(PLATE)).toHaveLength(1);
  });

  it('holds the two-slot cap when two people adopt the last slot at once', async () => {
    const results = await Promise.allSettled([
      adoptBed(store, { plate: PLATE, input: adoptInput({ firstName: 'Ada', email: 'a@example.com' }) }),
      adoptBed(store, { plate: PLATE, input: adoptInput({ firstName: 'Bea', email: 'b@example.com' }) }),
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
    await reportProblem(store, careInput({ actorId: 'visitor-1' }));
    const read = await store.getOpenReport(PLATE);
    read!.category = 'guard';
    read!.confirmedBy.push('never-happened');
    const stored = await store.getOpenReport(PLATE);
    expect(stored?.category).toBe('litter');
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
  it('accepts the seeded demo steward and rejects a wrong PIN with one generic error', async () => {
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

  it('leaves adoption alone at the PIN-hash bound, because adoption hashes nothing', async () => {
    // /adopt used to buy a bcrypt and be shed at this bound with the rest.
    // Passwordless removed the hash, so a saturated sign-in path no longer
    // costs anybody a slot — which is the good half of the trade.
    const held = Array.from({ length: MAX_INFLIGHT_PIN_HASHES }, () =>
      signIn(store, { username: 'marisol_r', pin: '1234' }).catch(() => null),
    );
    const user = await adoptBed(store, { plate: PLATE, input: adoptInput() });
    expect(user.username).toBe('rita_o');
    await Promise.all(held);
  });

  it('refuses a full bed on three cheap reads, which is what sheds a flood', async () => {
    await adoptBed(store, { plate: PLATE, input: adoptInput() });
    await expect(
      adoptBed(store, { plate: PLATE, input: adoptInput({ firstName: 'Tam' }) }),
    ).rejects.toMatchObject({ code: 'slots-full' });
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
      await reportProblem(store, careInput({ plate: 'BED-XX-0000', actorId: 'v' }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuleError);
      expect((err as RuleError).code).toBe('bed-not-found');
    }
  });
});
