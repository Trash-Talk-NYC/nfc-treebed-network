// The block admin's rules and the W 171st block's data — the same seam the
// visitor rules are tested through: a real LocalStore on a temp file, and the
// service layer in front of it.

import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import {
  DEMO_BLOCK_ID,
  W171_BLOCK_ID,
  ensureCheckedInBlocks,
  normalizeData,
  seedData,
  type Data,
} from '../src/lib/store-dataset';
import {
  MAX_ADDRESS_CHARS,
  MAX_BED_NOTE_CHARS,
  MAX_BED_SLOTS,
  MAX_NAME_CHARS,
  addBedByAdmin,
  addStewardByAdmin,
  adoptBed,
  getBedView,
  getBlockView,
  saveBlockSettings,
  validateAdminStewardInput,
} from '../src/lib/service';
function freshStore(): LocalStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'treebed-admin-test-'));
  return new LocalStore(path.join(dir, 'store.json'));
}

type BedSave = NonNullable<Parameters<typeof saveBlockSettings>[1]['bed']>;

/** One opened-bed save, with the panel's controls defaulted to untouched. */
function bedSave(overrides: Partial<BedSave> = {}): BedSave {
  return {
    plate: W171_PLATE,
    guard: 'none',
    treePresent: true,
    plantsPresent: false,
    plantingRecommended: false,
    plantsNote: '',
    recommendedPlantsNote: '',
    careNote: '',
    offeredSlotNumbers: [],
    addSlots: 0,
    ...overrides,
  };
}

function stewardInput(overrides: Partial<Parameters<typeof validateAdminStewardInput>[0]> = {}) {
  return {
    firstName: 'Dani',
    lastName: 'Torres',
    username: '',
    email: '',
    phone: '',
    ...overrides,
  };
}

/** The first W 171st bed: seeded with one slot and nothing offered. */
const W171_PLATE = 'BED-WH-1711';

describe('the six real beds on W 171st', () => {
  it('seeds the captain’s block: five willow oaks and one white oak, in order', async () => {
    const view = await getBlockView(freshStore(), W171_BLOCK_ID);
    expect(view).not.toBeNull();
    expect(view!.block.referenceAddress).toBe('708 W 171st St');
    expect(view!.block.demo).toBe(false);
    expect(view!.beds.map((b) => b.bed.blockPosition)).toEqual([1, 2, 3, 4, 5, 6]);
    const species = view!.beds.map((b) => b.bed.treeType.en);
    expect(species.filter((s) => s === 'Willow oak')).toHaveLength(5);
    expect(species.filter((s) => s === 'White oak')).toHaveLength(1);
  });

  it('carries a resolved NYC planting space on every bed, each a distinct record', async () => {
    const view = await getBlockView(freshStore(), W171_BLOCK_ID);
    const ids = view!.beds.map((b) => b.bed.plantingSpaceId);
    const globals = view!.beds.map((b) => b.bed.plantingSpaceGlobalId);
    // Resolved from NYC's Forestry Planting Spaces data, never invented — a
    // null here would be the honest alternative, and a duplicate would mean
    // two beds claimed one record.
    expect(ids.every((id) => id !== null)).toBe(true);
    expect(globals.every((id) => id !== null)).toBe(true);
    expect(new Set(ids).size).toBe(6);
    expect(new Set(globals).size).toBe(6);
  });

  it('seeds every bed with the profile defaults: no guard on record, a tree standing, nothing else', async () => {
    // Guards are ordered in the real world but none is IN, so the profile —
    // which records what stands at the bed — says none; the material goes in
    // on the admin page when the guards do.
    const view = await getBlockView(freshStore(), W171_BLOCK_ID);
    for (const { bed } of view!.beds) {
      expect(bed.guard, bed.plate).toBe('none');
      expect(bed.treePresent, bed.plate).toBe(true);
      expect(bed.plantsPresent, bed.plate).toBe(false);
      expect(bed.plantingRecommended, bed.plate).toBe(false);
      expect(bed.plantsNote, bed.plate).toBe('');
      expect(bed.recommendedPlantsNote, bed.plate).toBe('');
      expect(bed.careNote, bed.plate).toBe('');
    }
  });

  it('starts every bed unoffered: opening one is the captain’s act, on the admin page', async () => {
    const view = await getBlockView(freshStore(), W171_BLOCK_ID);
    for (const { bed } of view!.beds) {
      expect(bed.offeredSlots, bed.plate).toBe(0);
      expect(bed.slots, bed.plate).toBe(1);
    }
  });

  it('keeps the demo bed OUT of the real block, in its own demo-flagged one', async () => {
    const store = freshStore();
    const w171 = await getBlockView(store, W171_BLOCK_ID);
    expect(w171!.beds.map((b) => b.bed.plate)).not.toContain('BED-HRL-0847');
    const demo = await getBlockView(store, DEMO_BLOCK_ID);
    expect(demo!.block.demo).toBe(true);
    expect(demo!.beds.map((b) => b.bed.plate)).toEqual(['BED-HRL-0847']);
  });

  it('lists the real block above the demo one, whatever the ids alphabetise to', async () => {
    const blocks = await freshStore().getBlocks();
    expect(blocks.map((b) => b.id)).toEqual([W171_BLOCK_ID, DEMO_BLOCK_ID]);
  });
});

describe('the block reaches a store seeded before it existed', () => {
  it('backfills the blocks and beds additively into an older dataset', async () => {
    const data = await seedData();
    // A dataset from before blocks existed: strip everything this build added.
    delete (data as Partial<Data>).blocks;
    for (const plate of Object.keys(data.beds)) {
      if (plate !== 'BED-HRL-0847') delete data.beds[plate];
    }
    const demo = data.beds['BED-HRL-0847']! as unknown as Record<string, unknown>;
    delete demo.blockId;
    delete demo.blockPosition;
    delete demo.offeredSlots;
    delete demo.plantingSpaceGlobalId;
    // A live row from before the bed profile: no guard field, no facts, no
    // notes — and the earlier build's guard dates still on it, which stay.
    delete demo.guard;
    delete demo.treePresent;
    delete demo.plantsPresent;
    delete demo.plantsNote;
    delete demo.plantingRecommended;
    delete demo.recommendedPlantsNote;
    delete demo.careNote;
    demo.guardInstalledAt = '2026-04-18T16:00:00.000Z';

    const normalized = normalizeData(data);
    expect(Object.keys(normalized.blocks)).toContain(W171_BLOCK_ID);
    expect(
      Object.values(normalized.beds).filter((b) => b.blockId === W171_BLOCK_ID),
    ).toHaveLength(6);
    // The pre-existing bed keeps its meaning: every unfilled slot was
    // implicitly up for adoption before the switches existed.
    const bed = normalized.beds['BED-HRL-0847']!;
    expect(bed.offeredSlots).toBe(2);
    expect(bed.blockId).toBe(DEMO_BLOCK_ID);
    // The profile backfills to its defaults — the old dates never said what a
    // guard is MADE of, so the material stays the captain's to set — and the
    // legacy date survives untouched: additive and lossless.
    expect(bed.guard).toBe('none');
    expect(bed.treePresent).toBe(true);
    expect(bed.plantsPresent).toBe(false);
    expect(bed.plantingRecommended).toBe(false);
    expect(bed.plantsNote).toBe('');
    expect(bed.recommendedPlantsNote).toBe('');
    expect(bed.careNote).toBe('');
    expect((bed as unknown as Record<string, unknown>).guardInstalledAt).toBe(
      '2026-04-18T16:00:00.000Z',
    );
  });

  it('reads a single-category report and event from before multi-select, losslessly', async () => {
    // Live rows carry one `category`; the picker now files a list. Additive
    // normalization reads the old field into the new one on the way in and
    // deletes nothing, so an old row still says what it always said.
    const data = await seedData();
    data.reports.push({
      id: 'RPT-2216-0847',
      bedPlate: 'BED-HRL-0847',
      reporterId: 'visitor-legacy',
      category: 'guard',
      note: '',
      severity: null,
      openedAt: '2026-08-01T12:00:00.000Z',
      closedAt: null,
      closedBy: null,
      escalatedFrom: null,
      confirmedBy: [],
      photoAttached: false,
    } as unknown as Data['reports'][number]);
    data.events.push({
      id: 'event-legacy',
      bedPlate: 'BED-HRL-0847',
      eventType: 'confirm',
      severity: null,
      category: 'thirsty',
      note: 'legacy words',
      reportId: 'RPT-2216-0847',
      actorId: 'visitor-legacy-2',
      createdAt: '2026-08-01T12:05:00.000Z',
    } as unknown as Data['events'][number]);
    // Older still: a report from before the picker existed, with no category.
    data.reports.push({
      id: 'RPT-2215-0847',
      bedPlate: 'BED-HRL-0847',
      reporterId: 'visitor-older',
      openedAt: '2026-07-01T12:00:00.000Z',
      closedAt: '2026-07-02T12:00:00.000Z',
      closedBy: 'user-marisol',
      confirmedBy: [],
      photoAttached: false,
    } as unknown as Data['reports'][number]);

    const normalized = normalizeData(data);
    const [withCategory, older] = normalized.reports;
    expect(withCategory!.categories).toEqual(['guard']);
    // The stored field survives — additive, never a rewrite.
    expect((withCategory as unknown as Record<string, unknown>).category).toBe('guard');
    expect(older!.categories).toEqual(['litter']);
    expect(normalized.events[0]!.categories).toEqual(['thirsty']);
    expect(normalized.events[0]!.note).toBe('legacy words');
  });

  it('never overwrites what the captain has edited', async () => {
    const data = await seedData();
    data.blocks[W171_BLOCK_ID]!.referenceAddress = '710 W 171st St';
    data.beds[W171_PLATE]!.offeredSlots = 1;
    ensureCheckedInBlocks(data);
    expect(data.blocks[W171_BLOCK_ID]!.referenceAddress).toBe('710 W 171st St');
    expect(data.beds[W171_PLATE]!.offeredSlots).toBe(1);
  });
});

describe('offered slots are a rule, not a display state', () => {
  it('refuses adoption on a bed the captain has not offered', async () => {
    const store = freshStore();
    await expect(
      adoptBed(store, {
        plate: W171_PLATE,
        input: { firstName: 'Rita', lastName: 'Okafor', email: 'r@example.com', phone: '' },
      }),
    ).rejects.toMatchObject({ code: 'slots-full' });
  });

  it('admits exactly the offered count once a slot is switched on', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ offeredSlotNumbers: [1], addSlots: 0 }),
    });
    await adoptBed(store, {
      plate: W171_PLATE,
      input: { firstName: 'Rita', lastName: 'Okafor', email: 'r@example.com', phone: '' },
    });
    await expect(
      adoptBed(store, {
        plate: W171_PLATE,
        input: { firstName: 'Luz', lastName: 'Vega', email: 'l@example.com', phone: '' },
      }),
    ).rejects.toMatchObject({ code: 'slots-full' });
  });
});

describe('the visitor screens read the same bound the rules do', () => {
  it('reports no open slot on a bed the captain has not offered', async () => {
    const store = freshStore();
    const view = await getBedView(store, W171_PLATE);
    expect(view!.bed.slots).toBeGreaterThan(0);
    // The door screen and adopt.astro gate the invitation on this number, so
    // an unoffered bed must never show a form the rules would then refuse.
    expect(view!.openSlots).toBe(0);

    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ offeredSlotNumbers: [1], addSlots: 0 }),
    });
    expect((await getBedView(store, W171_PLATE))!.openSlots).toBe(1);
  });
});

describe('saving the block admin page', () => {
  it('refuses a gapped slot selection rather than re-mapping it to a count', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ offeredSlotNumbers: [], addSlots: 1 }),
    });
    await expect(
      saveBlockSettings(store, {
        blockId: W171_BLOCK_ID,
        referenceAddress: '',
        bed: bedSave({ offeredSlotNumbers: [2], addSlots: 0 }),
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    // Nothing was written, address included.
    expect((await store.getBed(W171_PLATE))!.offeredSlots).toBe(0);

    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ offeredSlotNumbers: [1, 2], addSlots: 0 }),
    });
    expect((await store.getBed(W171_PLATE))!.offeredSlots).toBe(2);
  });

  it('refuses a slot number the page never rendered a switch for, and says which refusal it is', async () => {
    const store = freshStore();
    // Its own code, not the gap one: a stale tab is not switches out of order,
    // and the panel prints a different sentence for each.
    await expect(
      saveBlockSettings(store, {
        blockId: W171_BLOCK_ID,
        referenceAddress: '',
        bed: bedSave({ offeredSlotNumbers: [9], addSlots: 0 }),
      }),
    ).rejects.toMatchObject({ code: 'slot-out-of-range' });
  });

  it('bounds the typed reference address rather than storing whatever was pasted', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: 'x'.repeat(MAX_ADDRESS_CHARS + 500),
    });
    expect((await store.getBlock(W171_BLOCK_ID))!.referenceAddress).toHaveLength(
      MAX_ADDRESS_CHARS,
    );
  });

  it('updates the typed reference address, and a blank one keeps what stands', async () => {
    const store = freshStore();
    await saveBlockSettings(store, { blockId: W171_BLOCK_ID, referenceAddress: '710 W 171st St' });
    expect((await store.getBlock(W171_BLOCK_ID))!.referenceAddress).toBe('710 W 171st St');
    await saveBlockSettings(store, { blockId: W171_BLOCK_ID, referenceAddress: '   ' });
    expect((await store.getBlock(W171_BLOCK_ID))!.referenceAddress).toBe('710 W 171st St');
  });

  it('saves the guard as one of three states, and back to none without losing anything else', async () => {
    const store = freshStore();
    const save = (guard: 'none' | 'wood' | 'metal') =>
      saveBlockSettings(store, {
        blockId: W171_BLOCK_ID,
        referenceAddress: '',
        bed: bedSave({ guard, careNote: 'Water on hot weeks.' }),
      });
    await save('wood');
    expect((await store.getBed(W171_PLATE))!.guard).toBe('wood');
    await save('metal');
    expect((await store.getBed(W171_PLATE))!.guard).toBe('metal');
    await save('none');
    const off = (await store.getBed(W171_PLATE))!;
    expect(off.guard).toBe('none');
    // The rest of the press rode along: the guard choice never costs a note.
    expect(off.careNote).toBe('Water on hot weeks.');
  });

  it('saves the bed profile — the switches and the typed notes, capped and stripped', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({
        treePresent: false,
        plantsPresent: true,
        plantingRecommended: true,
        // Typed fields go through `capped`: control characters and the bidi
        // overrides are stripped, then the bound cuts what remains.
        plantsNote: `  Daffodils and‮ a hosta  `,
        recommendedPlantsNote: 'x'.repeat(500),
        careNote: 'Litter pickup after weekends.',
      }),
    });
    const bed = (await store.getBed(W171_PLATE))!;
    expect(bed.treePresent).toBe(false);
    expect(bed.plantsPresent).toBe(true);
    expect(bed.plantingRecommended).toBe(true);
    expect(bed.plantsNote).toBe('Daffodils and a hosta');
    expect(bed.recommendedPlantsNote).toHaveLength(MAX_BED_NOTE_CHARS);
    expect(bed.careNote).toBe('Litter pickup after weekends.');
  });

  it('adds a slot up to the bound, and clamps what is offered to what exists', async () => {
    const store = freshStore();
    for (let i = 0; i < MAX_BED_SLOTS + 2; i++) {
      // Every switch the page would render for this bed, switched on.
      const { slots } = (await store.getBed(W171_PLATE))!;
      await saveBlockSettings(store, {
        blockId: W171_BLOCK_ID,
        referenceAddress: '',
        bed: bedSave({
          offeredSlotNumbers: Array.from({ length: slots }, (_, n) => n + 1),
          addSlots: 1,
        }),
      });
    }
    const bed = (await store.getBed(W171_PLATE))!;
    expect(bed.slots).toBe(MAX_BED_SLOTS);
    expect(bed.offeredSlots).toBe(MAX_BED_SLOTS);
  });

  it('absorbs a slot adopted between the render and the save rather than refusing the press', async () => {
    // The page drew both switches on an empty bed and the captain flipped
    // both. A neighbour adopted slot 1 in between, so the save arrives naming
    // a slot that is now filled — which must not cost the captain the whole
    // press, guard choice and address included.
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ offeredSlotNumbers: [1], addSlots: 1 }),
    });
    await addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() });
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '712 W 171st St',
      bed: bedSave({ guard: 'wood', offeredSlotNumbers: [1, 2], addSlots: 0 }),
    });
    const bed = (await store.getBed(W171_PLATE))!;
    expect(bed.offeredSlots).toBe(2);
    expect(bed.guard).toBe('wood');
    expect((await store.getBlock(W171_BLOCK_ID))!.referenceAddress).toBe('712 W 171st St');
  });

  it('never switches away a filled slot: the offered count always covers the stewards', async () => {
    const store = freshStore();
    await addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() });
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ offeredSlotNumbers: [], addSlots: 0 }),
    });
    expect((await store.getBed(W171_PLATE))!.offeredSlots).toBe(1);
  });
});

describe('the admin takes a bed’s name down', () => {
  /** Offer the bed's one slot, adopt it first, and name it on the way in. */
  async function namedBed(store: LocalStore): Promise<void> {
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ offeredSlotNumbers: [1], addSlots: 0 }),
    });
    await adoptBed(store, {
      plate: W171_PLATE,
      input: {
        firstName: 'Rita',
        lastName: 'Okafor',
        email: 'r.okafor@example.com',
        phone: '',
        bedName: 'La Madrina',
      },
    });
  }

  it('leaves the name alone on an ordinary save', async () => {
    const store = freshStore();
    await namedBed(store);
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ guard: 'wood', offeredSlotNumbers: [1], addSlots: 0 }),
    });
    expect((await store.getBed(W171_PLATE))!.bedName).toBe('La Madrina');
  });

  it('clears the name back to unnamed without touching the bed or its adoption', async () => {
    const store = freshStore();
    await namedBed(store);
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ offeredSlotNumbers: [1], clearBedName: true }),
    });
    const view = (await getBedView(store, W171_PLATE))!;
    // Unnamed again — and the steward, the slot and the bed are untouched:
    // the whole point of the control is taking down free text without
    // deleting anything a neighbour signed up for.
    expect(view.bed.bedName).toBeNull();
    expect(view.stewards).toHaveLength(1);
    expect(view.bed.slots).toBe(1);
  });
});

describe('writing a steward in, pen and paper', () => {
  it('records the sidewalk case explicitly: no email, no sign-in route, record held on their behalf', async () => {
    const store = freshStore();
    const user = await addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() });
    expect(user.email).toBe('');
    expect(user.pinHash).toBeNull();
    expect(user.hasSignInRoute).toBe(false);
    expect(user.recordHeldOnBehalf).toBe(true);
    expect(user.username).toBe('dani_t');
    const view = await getBlockView(store, W171_BLOCK_ID);
    const bed = view!.beds.find((b) => b.bed.plate === W171_PLATE)!;
    expect(bed.stewards).toHaveLength(1);
    expect(bed.stewards[0]!.adoption.stewardKind).toBe('pen-and-paper');
  });

  it('fills a slot the public switches never offered — writing in is the captain’s act', async () => {
    const store = freshStore();
    expect((await store.getBed(W171_PLATE))!.offeredSlots).toBe(0);
    await expect(
      addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() }),
    ).resolves.toBeTruthy();
  });

  it('refuses past the bed’s physical slots', async () => {
    const store = freshStore();
    await addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() });
    await expect(
      addStewardByAdmin(store, {
        plate: W171_PLATE,
        input: stewardInput({ firstName: 'Luz', lastName: 'Vega' }),
      }),
    ).rejects.toMatchObject({ code: 'slots-full' });
  });

  it('takes a typed username but refuses a collision rather than mutating it', async () => {
    const store = freshStore();
    const typed = await addStewardByAdmin(store, {
      plate: W171_PLATE,
      input: stewardInput({ username: '@dtorres' }),
    });
    expect(typed.username).toBe('dtorres');
    await expect(
      addStewardByAdmin(store, {
        plate: 'BED-WH-1712',
        input: stewardInput({ firstName: 'Delia', username: 'dtorres' }),
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('validates what is present and requires only the name', () => {
    expect(validateAdminStewardInput(stewardInput()).errors).toEqual({});
    expect(validateAdminStewardInput(stewardInput({ firstName: ' ' })).errors).toMatchObject({
      firstName: 'firstName',
    });
    expect(validateAdminStewardInput(stewardInput({ email: 'not-an-email' })).errors).toMatchObject({
      email: 'email',
    });
    expect(validateAdminStewardInput(stewardInput({ username: 'Bad Handle!' })).errors).toMatchObject({
      username: 'username',
    });
  });

  it('bounds a pasted name rather than storing whatever arrived', async () => {
    const { values } = validateAdminStewardInput(
      stewardInput({ firstName: 'a'.repeat(MAX_NAME_CHARS + 500) }),
    );
    expect(values.firstName).toHaveLength(MAX_NAME_CHARS);
  });
});

describe('adding a bed', () => {
  it('continues the block’s own plate sequence and starts closed, with no NYC identifiers', async () => {
    const store = freshStore();
    const bed = await addBedByAdmin(store, {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Pin oak', es: '' },
    });
    expect(bed.plate).toBe('BED-WH-1717');
    expect(bed.blockPosition).toBe(7);
    expect(bed.slots).toBe(1);
    expect(bed.offeredSlots).toBe(0);
    // Never invented: unresolved is null, and the admin panel says so.
    expect(bed.plantingSpaceId).toBeNull();
    expect(bed.plantingSpaceGlobalId).toBeNull();
    // Nobody looked anything up: the species table supplied the Spanish.
    expect(bed.treeType.es).toBe('roble palustre');
  });

  it('fills the Spanish name from the species table when the admin leaves it blank', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: '  willow   oak ', es: '' },
    });
    // The English name stays exactly what was typed (trimmed by the route,
    // capped here); the Spanish resolves through the table's tolerant match.
    expect(bed.treeType.en).toBe('willow   oak');
    expect(bed.treeType.es).toBe('roble sauce');
  });

  it('degrades an unknown species to the generic wording rather than guessing', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Dragon tree', es: '' },
    });
    expect(bed.treeType.en).toBe('Dragon tree');
    // Never the English name and never a transliteration: "árbol" is the
    // same wording normalizeData gives a bed with no tree type at all.
    expect(bed.treeType.es).toBe('árbol');
  });

  it('lets an explicitly supplied Spanish name win over the table', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Pin oak', es: 'Roble de los pantanos' },
    });
    expect(bed.treeType.es).toBe('Roble de los pantanos');
  });

  it('normalizes a typed name that is the table’s own shouted, so the door sentence reads', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Willow oak', es: 'Roble Sauce' },
    });
    // "El cantero de este roble sauce…" — mid-sentence, so lowercase.
    expect(bed.treeType.es).toBe('roble sauce');
  });

  it('stores a genuinely different typed name byte-for-byte, casing included', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Willow oak', es: 'Mi roble favorito' },
    });
    expect(bed.treeType.es).toBe('Mi roble favorito');
  });

  it('keeps the siblings’ zero padding, so a block’s plates stay one series', async () => {
    const store = freshStore();
    // The demo block's one bed is BED-HRL-0847 — four padded digits.
    const bed = await addBedByAdmin(store, {
      blockId: 'w-138-acp-demo',
      treeType: { en: 'Pin oak', es: 'Roble palustre' },
    });
    expect(bed.plate).toBe('BED-HRL-0848');
  });

  it('refuses a nameless tree', async () => {
    await expect(
      addBedByAdmin(freshStore(), { blockId: W171_BLOCK_ID, treeType: { en: '  ', es: '' } }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
