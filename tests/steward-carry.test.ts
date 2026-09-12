// Carrying a steward between beds (steward-carry.ts) — the tested, reversible
// path for the day the captain says which of the 22 named-run beds his
// adoption on BED-WH-1711 belongs to. What these prove, deliberately in the
// captain's own scenario: the adoption survives the carry intact, the carry
// reverses to exactly the state it started from, and every refusal refuses
// rather than guesses. Both callers are covered — the service wrapper the
// tests and app use (a store transaction) and the raw-dataset port the live
// remediation script uses (`scripts/carry-steward.mjs`).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { adoptBed, carryStewardByAdmin, getBedView, RuleError } from '../src/lib/service';
import { LocalStore } from '../src/lib/store-local';
import { seedData } from '../src/lib/store-dataset';
import { CarryRefusal, carrySteward, dataCarryPort } from '../src/lib/steward-carry';

const OLD_PLATE = 'BED-WH-1711';
const NEW_PLATE = '5SHFW171';

function freshStore(): LocalStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'treebed-carry-test-'));
  return new LocalStore(path.join(dir, 'store.json'));
}

/**
 * The captain's own state: a real adoption on BED-WH-1711, made through the
 * real adopt path (the bed opened first, as the admin page opened it live).
 */
async function storeWithCaptainAdoption(store: LocalStore) {
  await store.transaction(async (tx) => {
    const bed = await tx.getBed(OLD_PLATE);
    await tx.updateBed({ ...bed!, offeredSlots: 1 });
  });
  const user = await adoptBed(store, {
    plate: OLD_PLATE,
    input: {
      firstName: 'Fabiola',
      lastName: 'Villatoro',
      email: 'captain@example.invalid',
      phone: '',
      bedName: 'La Esquinita',
    },
  });
  return user;
}

describe('carrying the captain’s adoption onto a named-run bed', () => {
  it('moves the steward whole: same person, same adoptedAt, same standing', async () => {
    const store = freshStore();
    const user = await storeWithCaptainAdoption(store);
    const before = (await getBedView(store, OLD_PLATE))!.stewards[0]!;

    await carryStewardByAdmin(store, { userId: user.id, fromPlate: OLD_PLATE, toPlate: NEW_PLATE });

    const target = await getBedView(store, NEW_PLATE);
    expect(target!.stewards).toHaveLength(1);
    expect(target!.stewards[0]!.user.id).toBe(user.id);
    expect(target!.stewards[0]!.user.username).toBe(user.username);
    // The stewardship did not restart — the record was on the wrong bed.
    expect(target!.stewards[0]!.adoption.adoptedAt).toBe(before.adoption.adoptedAt);
    expect(target!.stewards[0]!.adoption.stewardKind).toBe(before.adoption.stewardKind);
    // The named bed reads as taken: door 2, no open slot for a stranger.
    expect(target!.openSlots).toBe(0);
    // The old bed reads unstewarded again; its record is released, not gone.
    const source = await getBedView(store, OLD_PLATE);
    expect(source!.stewards).toHaveLength(0);
    const released = (await store.getActiveAdoptionsForUser(user.id)).map((a) => a.bedPlate);
    expect(released).toEqual([NEW_PLATE]);
  });

  it('leaves everything keyed to the old plate where it was written', async () => {
    const store = freshStore();
    const user = await storeWithCaptainAdoption(store);

    await carryStewardByAdmin(store, { userId: user.id, fromPlate: OLD_PLATE, toPlate: NEW_PLATE });

    // The bed's given name is the BED's, and history is the site's: neither
    // follows the steward, because the correction moves a person, not a past.
    expect((await store.getBed(OLD_PLATE))!.bedName).toBe('La Esquinita');
    expect((await store.getBed(NEW_PLATE))!.bedName).toBeNull();
    // Both beds' histories say what happened, joined to the same actor.
    const releases = await store.getEvents(OLD_PLATE, 'release');
    expect(releases).toHaveLength(1);
    expect(releases[0]!.actorId).toBe(user.id);
    const adopts = await store.getEvents(NEW_PLATE, 'adopt');
    expect(adopts).toHaveLength(1);
    expect(adopts[0]!.actorId).toBe(user.id);
  });

  it('reverses with the plates swapped, back to exactly the standing it started from', async () => {
    const store = freshStore();
    const user = await storeWithCaptainAdoption(store);
    const before = (await getBedView(store, OLD_PLATE))!.stewards[0]!;

    await carryStewardByAdmin(store, { userId: user.id, fromPlate: OLD_PLATE, toPlate: NEW_PLATE });
    await carryStewardByAdmin(store, { userId: user.id, fromPlate: NEW_PLATE, toPlate: OLD_PLATE });

    const restored = await getBedView(store, OLD_PLATE);
    expect(restored!.stewards).toHaveLength(1);
    expect(restored!.stewards[0]!.user.id).toBe(user.id);
    expect(restored!.stewards[0]!.adoption.adoptedAt).toBe(before.adoption.adoptedAt);
    expect(restored!.stewards[0]!.adoption.stewardKind).toBe(before.adoption.stewardKind);
    // The named bed is open for adoption again, exactly as seeded.
    const target = await getBedView(store, NEW_PLATE);
    expect(target!.stewards).toHaveLength(0);
    expect(target!.openSlots).toBe(1);
  });
});

describe('what a carry refuses', () => {
  it('refuses a user with no active adoption on the source bed', async () => {
    const store = freshStore();
    await expect(
      carryStewardByAdmin(store, {
        userId: 'user-nobody',
        fromPlate: OLD_PLATE,
        toPlate: NEW_PLATE,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('refuses an unknown source bed, an inactive target, and a same-bed carry', async () => {
    const store = freshStore();
    const user = await storeWithCaptainAdoption(store);
    await expect(
      carryStewardByAdmin(store, { userId: user.id, fromPlate: 'BED-XX-0000', toPlate: NEW_PLATE }),
    ).rejects.toMatchObject({ code: 'bed-not-found' });
    await store.transaction(async (tx) => {
      const bed = await tx.getBed(NEW_PLATE);
      await tx.updateBed({ ...bed!, retiredAt: '2026-09-12T13:00:00.000Z' });
    });
    // A steward may not be carried onto a tombstone.
    await expect(
      carryStewardByAdmin(store, { userId: user.id, fromPlate: OLD_PLATE, toPlate: NEW_PLATE }),
    ).rejects.toMatchObject({ code: 'bed-not-found' });
    await expect(
      carryStewardByAdmin(store, { userId: user.id, fromPlate: OLD_PLATE, toPlate: OLD_PLATE }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('refuses a target already at its physical slots, and writes nothing', async () => {
    const store = freshStore();
    const user = await storeWithCaptainAdoption(store);
    // Somebody adopted the named bed at the tag first — its one slot is taken.
    await adoptBed(store, {
      plate: NEW_PLATE,
      input: {
        firstName: 'Dani',
        lastName: 'Torres',
        email: 'dani@example.invalid',
        phone: '',
        bedName: '',
      },
    });
    await expect(
      carryStewardByAdmin(store, { userId: user.id, fromPlate: OLD_PLATE, toPlate: NEW_PLATE }),
    ).rejects.toMatchObject({ code: 'slots-full' });
    // The refusal rolled everything back: the captain still stewards his bed.
    expect((await getBedView(store, OLD_PLATE))!.stewards[0]!.user.id).toBe(user.id);
  });

  it('still carries OFF a retired source — cleaning up behind a deleted bed is the point', async () => {
    const store = freshStore();
    const user = await storeWithCaptainAdoption(store);
    await store.transaction(async (tx) => {
      const bed = await tx.getBed(OLD_PLATE);
      await tx.updateBed({ ...bed!, retiredAt: '2026-09-12T13:00:00.000Z' });
    });
    await carryStewardByAdmin(store, { userId: user.id, fromPlate: OLD_PLATE, toPlate: NEW_PLATE });
    expect((await getBedView(store, NEW_PLATE))!.stewards[0]!.user.id).toBe(user.id);
  });
});

describe('the script’s path: the same rule over a raw dataset', () => {
  // scripts/carry-steward.mjs reads a Blobs revision, clones it, and applies
  // `carrySteward` through `dataCarryPort` — this is that exact call, on the
  // seeded dataset's own real adoption (marisol on the demo bed).
  it('moves the seeded adoption and reverses it, mutating only what a carry means', async () => {
    const data = seedData();
    const adoptionsBefore = structuredClone(data.adoptions);

    await carrySteward(dataCarryPort(data), {
      userId: 'user-marisol',
      fromPlate: 'BED-HRL-0847',
      toPlate: '3NHFW171',
    });

    const active = data.adoptions.filter((a) => a.releasedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.bedPlate).toBe('3NHFW171');
    expect(active[0]!.adoptedAt).toBe(adoptionsBefore[0]!.adoptedAt);
    // The released row stays — the record of the detour, never a deletion.
    expect(data.adoptions.find((a) => a.id === adoptionsBefore[0]!.id)!.releasedAt).not.toBeNull();
    expect(data.events.map((e) => [e.eventType, e.bedPlate])).toEqual([
      ['release', 'BED-HRL-0847'],
      ['adopt', '3NHFW171'],
    ]);

    await carrySteward(dataCarryPort(data), {
      userId: 'user-marisol',
      fromPlate: '3NHFW171',
      toPlate: 'BED-HRL-0847',
    });
    const restored = data.adoptions.filter((a) => a.releasedAt === null);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.bedPlate).toBe('BED-HRL-0847');
    expect(restored[0]!.adoptedAt).toBe(adoptionsBefore[0]!.adoptedAt);
  });

  it('refuses through the same CarryRefusal codes the service wrapper translates', async () => {
    const data = seedData();
    await expect(
      carrySteward(dataCarryPort(data), {
        userId: 'user-marisol',
        fromPlate: 'BED-HRL-0847',
        toPlate: 'BED-XX-0000',
      }),
    ).rejects.toBeInstanceOf(CarryRefusal);
    // And through the wrapper, the same refusal wears this layer's RuleError.
    const store = freshStore();
    await expect(
      carryStewardByAdmin(store, {
        userId: 'user-marisol',
        fromPlate: 'BED-HRL-0847',
        toPlate: 'BED-XX-0000',
      }),
    ).rejects.toBeInstanceOf(RuleError);
  });
});
