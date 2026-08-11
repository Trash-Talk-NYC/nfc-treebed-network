import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import {
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
  signIn,
  validateAdoptInput,
  verifyPin,
} from '../src/lib/service';

const PLATE = 'BED-HRL-0847';

function freshStore(): LocalStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'treebed-test-'));
  return new LocalStore(path.join(dir, 'store.json'));
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

let store: LocalStore;
beforeEach(() => {
  store = freshStore();
});

describe('PIN hashing', () => {
  it('round-trips a PIN and rejects a wrong one', () => {
    const hash = hashPin('4321');
    expect(hash).not.toContain('4321');
    expect(verifyPin('4321', hash)).toBe(true);
    expect(verifyPin('4322', hash)).toBe(false);
  });

  it('never stores a plaintext PIN on the user record', async () => {
    const user = await adoptBed(store, { plate: PLATE, input: adoptInput({ pin: '987654' }) });
    expect(JSON.stringify(user)).not.toContain('987654');
    expect(verifyPin('987654', user.pinHash)).toBe(true);
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
