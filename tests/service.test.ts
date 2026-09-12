import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import { MAX_NOTE_CHARS } from '../src/lib/problem';
import {
  MAX_BED_NAME_CHARS,
  MAX_CONFIRMATIONS,
  MAX_REPORT_PHOTOS,
  RuleError,
  adoptBed,
  claimApplauseNotice,
  closeReport,
  deleteReportPhotoByAdmin,
  engravedStewards,
  escalateReport,
  getBedView,
  GENERATED_USERNAME_RE,
  MAX_GENERATED_HANDLE_NUMBER,
  generateUsername,
  logTap,
  photoRendersInline,
  renameBedBySteward,
  reportPhotoCouldBeKept,
  reportProblem,
  sendApplause,
  storedPhotoContentType,
  validateAdoptInput,
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
    categories: ['litter' as const],
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
    categories: [],
    note: '',
    reportId: null,
    actorId: 'visitor-1',
    createdAt: new Date().toISOString(),
  };
}

let store: LocalStore;
beforeEach(() => {
  store = freshStore();
});

describe('passwordless adoption', () => {
  it('stores no secret at all for a steward who adopts at the tag', async () => {
    // The captain chose passwordless: a forgotten secret is permanent
    // lockout, and a cloned plaque on a public repo is a reusable secret to
    // harvest. The form collects none, so there is none to store — the way
    // back in is the emailed link, so `hasSignInRoute` follows the email.
    const user = await adoptBed(store, { plate: PLATE, input: adoptInput() });
    expect(user.hasSignInRoute).toBe(true);
    expect(user.digestOptedOut).toBe(false);
    expect(user.digestLastSentAt).toBeNull();
    // Not the pen-and-paper case: they signed themselves up and gave an email.
    expect(user.recordHeldOnBehalf).toBe(false);
  });

  it('records the language the screen spoke, defaulting to English', async () => {
    const es = await adoptBed(store, { plate: PLATE, input: adoptInput(), lang: 'es' });
    expect(es.lang).toBe('es');
    const bed = (await store.getBed('BED-WH-1711'))!;
    await store.updateBed({ ...bed, offeredSlots: 1 });
    const en = await adoptBed(store, {
      plate: 'BED-WH-1711',
      input: adoptInput({ firstName: 'Tam', email: 'tam@example.com' }),
    });
    expect(en.lang).toBe('en');
  });
});

describe('the first steward names the bed', () => {
  /**
   * A bed with nobody on it: the first W 171st bed, its one slot offered by
   * hand — the seeded demo bed already has marisol, so it can only ever host
   * a SECOND steward.
   */
  async function offeredEmptyBed(plate = 'BED-WH-1711'): Promise<string> {
    const bed = (await store.getBed(plate))!;
    await store.updateBed({ ...bed, offeredSlots: 1 });
    return plate;
  }

  it('stores the first steward’s name on the bed, trimmed to the cap', async () => {
    const plate = await offeredEmptyBed();
    await adoptBed(store, { plate, input: adoptInput({ bedName: '  La Madrina  ' }) });
    expect((await store.getBed(plate))!.bedName).toBe('La Madrina');
  });

  it('bounds the name like every other typed field', async () => {
    const plate = await offeredEmptyBed();
    await adoptBed(store, { plate, input: adoptInput({ bedName: 'x'.repeat(500) }) });
    expect((await store.getBed(plate))!.bedName).toHaveLength(MAX_BED_NAME_CHARS);
  });

  it('strips bidi characters a hand-built POST can carry, and keeps a control character as the gap it stood in', async () => {
    const plate = await offeredEmptyBed();
    await adoptBed(store, {
      plate,
      input: adoptInput({ bedName: '\u202eLa\nMadrina\u2069\u200f' }),
    });
    expect((await store.getBed(plate))!.bedName).toBe('La Madrina');
  });

  it('lets the first steward skip naming: the bed then simply has no name', async () => {
    const plate = await offeredEmptyBed();
    await adoptBed(store, { plate, input: adoptInput() });
    expect((await store.getBed(plate))!.bedName).toBeNull();
    // An explicit empty field is the same skip as an absent one.
    const other = await offeredEmptyBed('BED-WH-1712');
    await adoptBed(store, { plate: other, input: adoptInput({ bedName: '   ' }) });
    expect((await store.getBed(other))!.bedName).toBeNull();
  });

  it('ignores a name from anyone but the first steward — the adoption still goes through', async () => {
    // PLATE is the seeded demo bed: marisol already stewards it, so this is a
    // SECOND adoption. The form never offers them the field; this is the
    // hand-built POST that sends one anyway. Nobody at a tree is shown a
    // rule: the adoption commits and only the name is dropped.
    const user = await adoptBed(store, { plate: PLATE, input: adoptInput({ bedName: 'Hijacked' }) });
    expect((await getBedView(store, PLATE))!.stewards.map((s) => s.user.id)).toContain(user.id);
    expect((await store.getBed(PLATE))!.bedName).toBeNull();
  });

  it('keeps the name when its author leaves, and the next steward cannot rename', async () => {
    const plate = await offeredEmptyBed();
    const author = await adoptBed(store, { plate, input: adoptInput({ bedName: 'La Madrina' }) });
    // Release the author directly in the stored file: no release flow exists
    // in the visitor build, and the name surviving must not depend on how a
    // steward comes off the bed — it is the bed's name, not their profile.
    const raw = JSON.parse(readFileSync(storeFile, 'utf8')) as {
      adoptions: Array<{ userId: string; releasedAt: string | null }>;
    };
    for (const adoption of raw.adoptions) {
      if (adoption.userId === author.id) adoption.releasedAt = '2026-09-10T12:00:00.000Z';
    }
    writeFileSync(storeFile, JSON.stringify(raw));
    const reopened = new LocalStore(storeFile);
    const view = (await getBedView(reopened, plate))!;
    expect(view.stewards).toHaveLength(0);
    expect(view.bed.bedName).toBe('La Madrina');
    // The next adopter is the first ACTIVE steward again, but the bed already
    // has its name — "that name is the bed's name from then on". Only the
    // admin's clear opens naming again.
    await adoptBed(reopened, {
      plate,
      input: adoptInput({ firstName: 'Tam', email: 't@example.com', bedName: 'Renamed' }),
    });
    expect((await reopened.getBed(plate))!.bedName).toBe('La Madrina');
  });
});

describe('the handle, generated rather than derived or typed', () => {
  it('always has the shape <Word>Steward<number>', () => {
    // Fifty rolls with the real rng: every one must be a curated word plus
    // Steward plus a number -- the shape the captain asked for (@MapleSteward42).
    for (let i = 0; i < 50; i += 1) {
      expect(generateUsername(() => false)).toMatch(GENERATED_USERNAME_RE);
    }
  });

  it('is a roll of the injected rng, not a function of any name', () => {
    // rng 0 picks the first word and the lowest number, deterministically.
    expect(generateUsername(() => false, () => 0)).toBe('MapleSteward10');
  });

  it('clamps a pathological rng rather than writing its output into a handle', () => {
    // Out of range either way, and NaN — which slips through a bare min/max
    // and would put `undefined` or `NaN` into a handle that gets written.
    for (const value of [1, 1.5, -1, Number.NaN]) {
      expect(generateUsername(() => false, () => value)).toMatch(GENERATED_USERNAME_RE);
    }
  });

  it('retries past a candidate somebody already holds', () => {
    const first = generateUsername(() => false, () => 0);
    const second = generateUsername((c) => c === first, () => 0);
    // The rng keeps rolling the taken candidate, so the deterministic sweep
    // must hand out the next free one rather than loop or mutate the handle.
    expect(second).toBe('OakSteward10');
    expect(second).toMatch(GENERATED_USERNAME_RE);
  });

  it('matches the exported shape all the way to the sweep ceiling', () => {
    // The sweep can hand out numbers past 999 once the 2-3 digit ones are
    // gone, and the exported regex is what the e2e suite recognises a
    // generated steward by, so the two must agree on the widest handle.
    const number = (c: string) => Number(c.replace(/^[A-Za-z]+Steward/, ''));
    const sweptWide = generateUsername((c) => number(c) < 1000, () => 0);
    expect(sweptWide).toBe('MapleSteward1000');
    expect(sweptWide).toMatch(GENERATED_USERNAME_RE);
    expect(`MapleSteward${MAX_GENERATED_HANDLE_NUMBER}`).toMatch(GENERATED_USERNAME_RE);
    expect(`MapleSteward${MAX_GENERATED_HANDLE_NUMBER + 1}`).not.toMatch(GENERATED_USERNAME_RE);
  });

  it('refuses rather than spins when every candidate is taken', () => {
    // The sweep's termination is a guarantee, not a property of today's
    // callers: a `taken` that answers true for everything hits the ceiling
    // and throws instead of walking numbers forever.
    expect(() => generateUsername(() => true, () => 0)).toThrow(/every .*handle .* is taken/);
  });

  it('hands a new steward a generated handle with none of their name in it', async () => {
    const first = await adoptBed(store, {
      plate: PLATE,
      input: adoptInput({ firstName: 'Marisol', lastName: 'Rivera' }),
    });
    expect(first.username).toMatch(GENERATED_USERNAME_RE);
    expect(first.username.toLowerCase()).not.toContain('marisol');
  });

  it('walks past a handle the store already holds, inside the transaction', async () => {
    // Pin the rng so every random roll is the same candidate: the first
    // adoption takes it, and the second MUST come out different -- proof the
    // in-transaction store walk retries rather than committing a duplicate.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const first = await adoptBed(store, { plate: PLATE, input: adoptInput() });
      expect(first.username).toBe('MapleSteward10');
      const plate = 'BED-WH-1711';
      const bed = (await store.getBed(plate))!;
      await store.updateBed({ ...bed, offeredSlots: 1 });
      const second = await adoptBed(store, {
        plate,
        input: adoptInput({ firstName: 'Luz', lastName: 'Vega', email: 'luz@example.com' }),
      });
      expect(second.username).toBe('OakSteward10');
    } finally {
      spy.mockRestore();
    }
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
    const outcome = await reportProblem(store, careInput({ categories: ['thirsty'] }));
    expect(outcome.kind).toBe('filed');
    expect(outcome.report?.id).toMatch(/^RPT-\d+-0847$/);
    expect(outcome.report?.categories).toEqual(['thirsty']);
    // Nothing on the street sets severity: the problem screen asks what is
    // wrong, not how bad.
    expect(outcome.report?.severity).toBeNull();
  });

  it('files every tile the visitor pressed, deduplicated, in tile order', async () => {
    // The picker is multi-select: a bed that is thirsty AND full of litter is
    // one report. Submission order and a hand-built duplicate change nothing —
    // the record reads in tile order either way.
    const outcome = await reportProblem(
      store,
      careInput({ categories: ['guard', 'thirsty', 'guard'] }),
    );
    expect(outcome.kind).toBe('filed');
    expect(outcome.report?.categories).toEqual(['thirsty', 'guard']);
    const [filed] = await store.getEvents(PLATE, 'report');
    expect(filed?.categories).toEqual(['thirsty', 'guard']);
  });

  it('refuses a report naming no problem at all', async () => {
    // The route redirects an empty picker back to the screen; this is the
    // rule under it, for a caller that skips the screen entirely.
    await expect(reportProblem(store, careInput({ categories: [] }))).rejects.toMatchObject({
      code: 'invalid-input',
    });
    expect(await store.getReports(PLATE)).toHaveLength(0);
  });

  it('keeps the sentence behind "something else", capped', async () => {
    const long = 'x'.repeat(MAX_NOTE_CHARS + 50);
    const outcome = await reportProblem(store, careInput({ categories: ['other'], note: long }));
    expect(outcome.report?.categories).toEqual(['other']);
    expect(outcome.report?.note).toHaveLength(MAX_NOTE_CHARS);
  });

  it('strips what a hand-built note could carry into a screen, like every typed field', async () => {
    // The note is the most attacker-controllable string in the build and it
    // renders as a leaf beside copy of ours — the steward's view, the admin
    // panel, the too-large screen. It goes through the same sanitisation the
    // admin's own fields do: the bidi overrides are dropped, control
    // characters and whitespace runs collapse to one space.
    const outcome = await reportProblem(
      store,
      careInput({ categories: ['other'], note: '  hay\u202e una\r\n\trata  muerta  ' }),
    );
    expect(outcome.report?.note).toBe('hay una rata muerta');
  });

  it('keeps the sentence when "something else" rides alongside another tile', async () => {
    const outcome = await reportProblem(
      store,
      careInput({ categories: ['other', 'litter'], note: 'hay una rata muerta' }),
    );
    expect(outcome.kind).toBe('filed');
    expect(outcome.report?.categories).toEqual(['litter', 'other']);
    expect(outcome.report?.note).toBe('hay una rata muerta');
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
    await reportProblem(store, careInput({ actorId: 'visitor-1', categories: ['litter'], note: '' }));
    const second = await reportProblem(
      store,
      careInput({
        actorId: 'visitor-2',
        categories: ['guard', 'thirsty'],
        note: 'la reja está doblada y hay un clavo suelto',
        photoAttached: true,
      }),
    );
    expect(second.kind).toBe('added-weight');
    const [confirm] = await store.getEvents(PLATE, 'confirm');
    expect(confirm?.categories).toEqual(['thirsty', 'guard']);
    expect(confirm?.note).toBe('la reja está doblada y hay un clavo suelto');
    // A photo attached to the second press is still a photo of the bed's open
    // problem.
    expect((await store.getOpenReport(PLATE))?.photoAttached).toBe(true);
  });

  it('records the categories and the note on the report event too', async () => {
    await reportProblem(store, careInput({ categories: ['thirsty'], note: 'la tierra está seca' }));
    const [filed] = await store.getEvents(PLATE, 'report');
    expect(filed?.categories).toEqual(['thirsty']);
    expect(filed?.note).toBe('la tierra está seca');
  });

  it('names the report each event is about, so a later lap does not claim an earlier one', async () => {
    // `report → clear → report` is a supported loop, so a time window would
    // hand the wrong lap's neighbour to a steward. The id cannot.
    const noon = new Date('2026-08-11T16:00:00Z');
    const nextDay = new Date('2026-08-12T16:00:00Z');
    const first = await reportProblem(store, careInput({ actorId: 'visitor-1', now: noon }));
    await reportProblem(store, careInput({ actorId: 'visitor-2', note: 'lap one', now: noon }));
    await closeReport(store, { plate: PLATE, actorId: 'visitor-9', now: noon });
    const second = await reportProblem(store, careInput({ actorId: 'visitor-1', now: nextDay }));
    await reportProblem(store, careInput({ actorId: 'visitor-3', note: 'lap two', now: nextDay }));

    expect(first.report?.id).not.toBe(second.report?.id);
    const confirms = await store.getEvents(PLATE, 'confirm');
    const forSecond = confirms.filter((e) => e.reportId === second.report?.id);
    expect(forSecond.map((e) => e.note)).toEqual(['lap two']);
    const filed = await store.getEvents(PLATE, 'report');
    expect(filed.map((e) => e.reportId).sort()).toEqual(
      [first.report?.id, second.report?.id].sort(),
    );
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
    expect(
      (await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: noon })).counted,
    ).toBe(true);
    // `events` is append-only with nothing pruning it, so a button anybody can
    // press without signing in has to stop costing something at some point.
    expect(await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: evening })).toEqual({
      counted: false,
      noticeQueued: false,
    });
    expect(
      (await sendApplause(store, { plate: PLATE, actorId: 'visitor-2', now: noon })).counted,
    ).toBe(true);
    expect(
      (await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: nextDay })).counted,
    ).toBe(true);
    expect(await store.getEvents(PLATE, 'applause')).toHaveLength(3);
  });

  it('queues one notice per bed per NY day, and claims the day before anything is sent', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    const evening = new Date('2026-08-11T23:00:00Z'); // 19:00 NY, same day
    const nextDay = new Date('2026-08-12T16:00:00Z');
    // The first counted applause of the day queues the notice and claims the
    // day on the spot. Nothing is mailed here: the press is somebody standing
    // at a tree, and the scheduled run delivers it (digest.ts).
    const first = await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: noon });
    expect(first).toEqual({ counted: true, noticeQueued: true });
    expect((await store.getBed(PLATE))!.applauseNoticeAt).toBe(noon.toISOString());
    expect((await store.getBed(PLATE))!.applauseNoticeDueAt).toBe(noon.toISOString());
    // A second neighbour the same NY day: counted, but the steward already
    // heard — a popular bed must not become a noisy inbox.
    const second = await sendApplause(store, { plate: PLATE, actorId: 'visitor-2', now: evening });
    expect(second).toEqual({ counted: true, noticeQueued: false });
    // Claimed, and the claim names the mailable steward and empties the queue.
    const claimed = await claimApplauseNotice(store, PLATE);
    expect(claimed?.recipients.map((u) => u.id)).toEqual(['user-marisol']);
    expect((await store.getBed(PLATE))!.applauseNoticeDueAt).toBeNull();
    // Claim-then-send: a rerun of the same day finds nothing to send.
    expect(await claimApplauseNotice(store, PLATE)).toBeNull();
    // The next day starts fresh.
    const tomorrow = await sendApplause(store, { plate: PLATE, actorId: 'visitor-3', now: nextDay });
    expect(tomorrow.noticeQueued).toBe(true);
    expect((await store.getBedsWithApplauseNoticeDue()).map((b) => b.plate)).toEqual([PLATE]);
  });

  it('never names a steward who opted out or has no email, and hands the day back', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    const marisol = (await store.getUser('user-marisol'))!;
    await store.updateUser({ ...marisol, digestOptedOut: true });
    // Opted out of the digest opts out of applause mail too — one flag, every
    // courtesy mail — and with nobody mailable the claim hands the day BACK,
    // so a steward who resumes later that day does not find it already spent.
    await sendApplause(store, { plate: PLATE, actorId: 'visitor-1', now: noon });
    expect(await claimApplauseNotice(store, PLATE)).toBeNull();
    let bed = (await store.getBed(PLATE))!;
    expect(bed.applauseNoticeDueAt).toBeNull();
    expect(bed.applauseNoticeAt).toBeNull();

    await store.updateUser({ ...marisol, digestOptedOut: false, email: '' });
    await sendApplause(store, { plate: PLATE, actorId: 'visitor-2', now: noon });
    expect(await claimApplauseNotice(store, PLATE)).toBeNull();
    bed = (await store.getBed(PLATE))!;
    expect(bed.applauseNoticeDueAt).toBeNull();
    expect(bed.applauseNoticeAt).toBeNull();
  });
});

describe('a carried photo the rules would decline', () => {
  const care = (over: Partial<Parameters<typeof reportProblem>[1]> = {}) => ({
    plate: PLATE,
    actorId: 'visitor-1',
    categories: ['litter' as const],
    note: '',
    photoAttached: false,
    ...over,
  });

  it('is not worth uploading for a press the rule is about to decline', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    // Nothing open, nothing said today: the upload is worth making.
    expect(await reportPhotoCouldBeKept(store, { plate: PLATE, actorId: 'visitor-1', now: noon })).toBe(true);
    await reportProblem(store, care({ now: noon }));
    // Their own open report — the press is 'already-said', so the megabytes
    // would be written and deleted again.
    expect(await reportPhotoCouldBeKept(store, { plate: PLATE, actorId: 'visitor-1', now: noon })).toBe(false);
    // A second neighbour adds weight, so theirs is worth keeping.
    expect(await reportPhotoCouldBeKept(store, { plate: PLATE, actorId: 'visitor-2', now: noon })).toBe(true);
    await reportProblem(store, care({ actorId: 'visitor-2', now: noon }));
    expect(await reportPhotoCouldBeKept(store, { plate: PLATE, actorId: 'visitor-2', now: noon })).toBe(false);
  });

  it('is not worth uploading at a bed the admin has retired', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    const bed = (await store.getBed(PLATE))!;
    await store.updateBed({ ...bed, retiredAt: noon.toISOString() });
    expect(await reportPhotoCouldBeKept(store, { plate: PLATE, actorId: 'visitor-1', now: noon })).toBe(false);
  });

  it('is not worth uploading once the report is at its photo cap', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    const filed = await reportProblem(store, care({ now: noon }));
    const reportId = filed.report!.id;
    for (let i = 0; i < MAX_REPORT_PHOTOS; i += 1) {
      await store.addReportPhoto({
        id: `photo-${i}`,
        bedPlate: PLATE,
        reportId,
        actorId: `visitor-${i + 10}`,
        contentType: 'image/jpeg',
        bytes: 1024,
        uploadedAt: noon.toISOString(),
      });
    }
    expect(await reportPhotoCouldBeKept(store, { plate: PLATE, actorId: 'visitor-99', now: noon })).toBe(false);
  });

  it('says nothing about the day already reported by somebody else', async () => {
    const noon = new Date('2026-08-11T16:00:00Z');
    const later = new Date('2026-08-11T20:00:00Z');
    await reportProblem(store, care({ now: noon }));
    await closeReport(store, { plate: PLATE, actorId: 'user-marisol', now: later });
    // Their own report is closed, but they have had their say today: the next
    // press writes nothing, so its photo is not worth uploading either.
    expect(await reportPhotoCouldBeKept(store, { plate: PLATE, actorId: 'visitor-1', now: later })).toBe(false);
    expect(await reportPhotoCouldBeKept(store, { plate: PLATE, actorId: 'visitor-2', now: later })).toBe(true);
  });
});

describe('renaming the bed from the steward view', () => {
  it('lets any active steward rename, and writes the trail event', async () => {
    const now = new Date('2026-09-12T16:00:00Z');
    // The seeded steward is not the first namer of anything — the demo bed is
    // unnamed — which is the point: any active steward may name or rename.
    await renameBedBySteward(store, { plate: PLATE, userId: 'user-marisol', name: '  La Madrina  ', now });
    expect((await store.getBed(PLATE))!.bedName).toBe('La Madrina');
    const trail = await store.getEvents(PLATE, 'rename');
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actorId: 'user-marisol', note: 'La Madrina' });

    // Renaming again is allowed — that is the captain's decision — and each
    // rename is its own event, so the record says who changed it and to what.
    await renameBedBySteward(store, { plate: PLATE, userId: 'user-marisol', name: 'El Roble', now });
    expect((await store.getBed(PLATE))!.bedName).toBe('El Roble');
    expect(await store.getEvents(PLATE, 'rename')).toHaveLength(2);
  });

  it('refuses a caller who is not an active steward of the bed', async () => {
    await expect(
      renameBedBySteward(store, { plate: PLATE, userId: 'visitor-1', name: 'Mine Now' }),
    ).rejects.toMatchObject({ code: 'not-steward' });
    expect((await store.getBed(PLATE))!.bedName).toBeNull();
    expect(await store.getEvents(PLATE, 'rename')).toHaveLength(0);
  });

  it('refuses an empty name — a takedown stays the admin’s act', async () => {
    await renameBedBySteward(store, { plate: PLATE, userId: 'user-marisol', name: 'La Madrina' });
    await expect(
      renameBedBySteward(store, { plate: PLATE, userId: 'user-marisol', name: '   ' }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect((await store.getBed(PLATE))!.bedName).toBe('La Madrina');
  });

  it('bounds and sanitises the name like every other typed field, and no-ops an unchanged one', async () => {
    const long = 'x'.repeat(MAX_BED_NAME_CHARS + 25);
    await renameBedBySteward(store, { plate: PLATE, userId: 'user-marisol', name: long });
    expect((await store.getBed(PLATE))!.bedName).toBe('x'.repeat(MAX_BED_NAME_CHARS));
    // Saving the same name again writes no second event: nothing changed.
    await renameBedBySteward(store, { plate: PLATE, userId: 'user-marisol', name: long });
    expect(await store.getEvents(PLATE, 'rename')).toHaveLength(1);
  });
});

describe('stored care photos', () => {
  /** A stored-blob stand-in: the rule only records metadata. */
  function photoInput(id: string) {
    return { id, contentType: 'image/jpeg', bytes: 123_456 };
  }

  it('records the photo on the report a filing press opens', async () => {
    const outcome = await reportProblem(
      store,
      careInput({ photoAttached: true, photo: photoInput('photo-a') }),
    );
    expect(outcome.kind).toBe('filed');
    if (outcome.kind === 'filed') {
      expect(outcome.photo).toMatchObject({
        id: 'photo-a',
        reportId: outcome.report.id,
        bedPlate: PLATE,
        actorId: 'visitor-1',
        contentType: 'image/jpeg',
      });
      expect(await store.getReportPhotosForReport(outcome.report.id)).toHaveLength(1);
      expect(await store.getReportPhotosForBed(PLATE)).toHaveLength(1);
    }
  });

  it('binds a confirming neighbour’s photo to the OPEN report, by id', async () => {
    const filed = await reportProblem(store, careInput({ actorId: 'visitor-1' }));
    const confirmed = await reportProblem(
      store,
      careInput({ actorId: 'visitor-2', photoAttached: true, photo: photoInput('photo-b') }),
    );
    expect(confirmed.kind).toBe('added-weight');
    if (confirmed.kind === 'added-weight' && filed.kind === 'filed') {
      expect(confirmed.photo?.reportId).toBe(filed.report.id);
    }
  });

  it('declines the photo of a press that wrote nothing, so the caller can drop the blob', async () => {
    await reportProblem(store, careInput({ actorId: 'visitor-1' }));
    // Same person, same day: the press writes nothing, and the outcome names
    // no photo — the route deletes the already-written blob on that answer.
    const again = await reportProblem(
      store,
      careInput({ actorId: 'visitor-1', photoAttached: true, photo: photoInput('photo-c') }),
    );
    expect(again.kind).toBe('already-said');
    expect(await store.getReportPhotosForBed(PLATE)).toHaveLength(0);
  });

  it('stops storing at MAX_REPORT_PHOTOS per report; the press still counts', async () => {
    await reportProblem(
      store,
      careInput({ actorId: 'visitor-0', photoAttached: true, photo: photoInput('photo-0') }),
    );
    for (let i = 1; i < MAX_REPORT_PHOTOS; i += 1) {
      await reportProblem(
        store,
        careInput({ actorId: `visitor-${i}`, photoAttached: true, photo: photoInput(`photo-${i}`) }),
      );
    }
    const past = await reportProblem(
      store,
      careInput({ actorId: 'visitor-999', photoAttached: true, photo: photoInput('photo-over') }),
    );
    // The confirm counted — nobody standing at a tree is shown a rule — but
    // the photo was declined, exactly as the pre-storage build discarded all.
    expect(past.kind).toBe('added-weight');
    if (past.kind === 'added-weight') {
      expect(past.photo).toBeNull();
      expect(past.report.confirmedBy).toContain('visitor-999');
      expect(await store.getReportPhotosForReport(past.report.id)).toHaveLength(MAX_REPORT_PHOTOS);
    }
  });

  it('stores only allowlisted content types; anything else downloads instead of rendering', async () => {
    // The stored type is what the admin serving route answers with, so a
    // scriptable type must never survive the write.
    expect(storedPhotoContentType('IMAGE/JPEG')).toBe('image/jpeg');
    expect(storedPhotoContentType(' image/png ')).toBe('image/png');
    expect(storedPhotoContentType('image/svg+xml')).toBe('application/octet-stream');
    expect(storedPhotoContentType('text/html')).toBe('application/octet-stream');
    expect(storedPhotoContentType('')).toBe('application/octet-stream');
    expect(photoRendersInline('image/jpeg')).toBe(true);
    expect(photoRendersInline('image/heic')).toBe(false);
    expect(photoRendersInline('text/html')).toBe(false);

    const outcome = await reportProblem(
      store,
      careInput({
        photoAttached: true,
        photo: { id: 'photo-svg', contentType: 'image/svg+xml', bytes: 10 },
      }),
    );
    if (outcome.kind === 'filed') {
      expect(outcome.photo?.contentType).toBe('application/octet-stream');
    }
  });

  it('lets the admin delete a photo, scoped to the block the page names', async () => {
    const outcome = await reportProblem(
      store,
      careInput({ photoAttached: true, photo: photoInput('photo-d') }),
    );
    expect(outcome.kind).toBe('filed');
    // The demo bed lives in its own demo block (store-dataset.ts); another
    // block's page cannot reach its photos.
    await expect(
      deleteReportPhotoByAdmin(store, { blockId: 'w-171-fort-washington-haven', photoId: 'photo-d' }),
    ).rejects.toMatchObject({ code: 'photo-not-found' });
    const removed = await deleteReportPhotoByAdmin(store, {
      blockId: 'w-138-acp-demo',
      photoId: 'photo-d',
    });
    expect(removed.id).toBe('photo-d');
    expect(await store.getReportPhotosForBed(PLATE)).toHaveLength(0);
    // The report the photo rode in on is untouched — what the neighbour SAID
    // is not what was moderated — and the flag stays true as history.
    if (outcome.kind === 'filed') {
      expect((await store.getReport(outcome.report.id))!.photoAttached).toBe(true);
    }
    // Already gone: the confirmation page turns this into the block page.
    await expect(
      deleteReportPhotoByAdmin(store, { blockId: 'w-138-acp-demo', photoId: 'photo-d' }),
    ).rejects.toMatchObject({ code: 'photo-not-found' });
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

  it('names the report on the events that end it, so a later lap cannot claim them', async () => {
    const first = (await store.getOpenReport(PLATE))!;
    await escalateReport(store, { plate: PLATE, actorId: 'visitor-2' });
    await closeReport(store, { plate: PLATE, actorId: 'visitor-77' });
    // A second lap of report -> clear -> report on the same bed: the trail says
    // which report each ending belongs to, rather than leaving it to timestamps.
    await reportProblem(store, careInput({ actorId: 'visitor-3' }));
    const second = (await store.getOpenReport(PLATE))!;
    await closeReport(store, { plate: PLATE, actorId: 'visitor-77' });

    expect((await store.getEvents(PLATE, 'escalate')).map((e) => e.reportId)).toEqual([first.id]);
    expect((await store.getEvents(PLATE, 'clear')).map((e) => e.reportId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(first.id).not.toBe(second.id);
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

});

describe('store contract', () => {
  it('hands out detached copies, so mutating a read never reaches stored state', async () => {
    await reportProblem(store, careInput({ actorId: 'visitor-1' }));
    const read = await store.getOpenReport(PLATE);
    read!.categories.push('guard');
    read!.confirmedBy.push('never-happened');
    const stored = await store.getOpenReport(PLATE);
    expect(stored?.categories).toEqual(['litter']);
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

describe('adoption under load', () => {
  it('refuses a full bed on three cheap reads, which is what sheds a flood', async () => {
    await adoptBed(store, { plate: PLATE, input: adoptInput() });
    await expect(
      adoptBed(store, { plate: PLATE, input: adoptInput({ firstName: 'Tam' }) }),
    ).rejects.toMatchObject({ code: 'slots-full' });
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
