// The block admin's rules and the W 171st block's data — the same seam the
// visitor rules are tested through: a real LocalStore on a temp file, and the
// service layer in front of it.

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import {
  DEMO_BLOCK_ID,
  HAVEN_EAST_RUN_BLOCK_ID,
  NORTH_RUN_BLOCK_ID,
  SOUTH_RUN_BLOCK_ID,
  W171_BLOCK_ID,
  ensureCheckedInBlocks,
  normalizeData,
  seedData,
  type Data,
} from '../src/lib/store-dataset';
import {
  GENERATED_USERNAME_RE,
  MAX_ADDRESS_CHARS,
  MAX_BED_NOTE_CHARS,
  MAX_BED_SLOTS,
  MAX_NAME_CHARS,
  MAX_TREE_TYPE_CHARS,
  addBedByAdmin,
  addStewardByAdmin,
  adoptBed,
  getBedView,
  getBlockView,
  reportProblem,
  restoreBedByAdmin,
  retireBedByAdmin,
  saveBlockSettings,
  sendApplause,
  validateAdminStewardInput,
} from '../src/lib/service';
import { UNRECORDED_CHOICE, bedFactFrom, guardMaterialFrom } from '../src/lib/types';
function freshStore(): LocalStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'treebed-admin-test-'));
  return new LocalStore(path.join(dir, 'store.json'));
}

type BedSave = NonNullable<Parameters<typeof saveBlockSettings>[1]['bed']>;

/** One opened-bed save, with the panel's controls defaulted to untouched. */
function bedSave(overrides: Partial<BedSave> = {}): BedSave {
  return {
    plate: W171_PLATE,
    // Every profile field defaults to "the form did not carry it", which is
    // the save's keep-as-it-stands: a test says what it means to change.
    treeType: undefined,
    guard: undefined,
    treePresent: undefined,
    plantsPresent: undefined,
    plantingRecommended: undefined,
    plantsNote: undefined,
    recommendedPlantsNote: undefined,
    careNote: undefined,
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
    const species = view!.beds.map((b) => b.bed.treeType!.en);
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

  it('seeds every bed with the profile defaults: nothing recorded at all', async () => {
    // Guards are ordered in the real world and tags go in with them, so the
    // profile asserts nothing about the guard — null, never 'none' — until
    // the captain records the material on the admin page. The tree, the
    // plants and the planting recommendation follow the same rule: null,
    // never false, so the public page publishes "nothing planted yet" — or
    // "no tree" — only once somebody has stood at the bed and said so.
    const view = await getBlockView(freshStore(), W171_BLOCK_ID);
    for (const { bed } of view!.beds) {
      expect(bed.guard, bed.plate).toBeNull();
      expect(bed.treePresent, bed.plate).toBeNull();
      expect(bed.plantsPresent, bed.plate).toBeNull();
      expect(bed.plantingRecommended, bed.plate).toBeNull();
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

  it('lists the real blocks above the demo one, whatever the ids alphabetise to', async () => {
    const blocks = await freshStore().getBlocks();
    // Every real street — the captain's original block and the three named
    // runs — sits above the DEMO-badged one, in stable id order.
    expect(blocks.map((b) => b.id)).toEqual([
      HAVEN_EAST_RUN_BLOCK_ID,
      W171_BLOCK_ID,
      NORTH_RUN_BLOCK_ID,
      SOUTH_RUN_BLOCK_ID,
      DEMO_BLOCK_ID,
    ]);
  });
});

describe('the block reaches a store seeded before it existed', () => {
  it('backfills the blocks and beds additively into an older dataset', async () => {
    const data = seedData();
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
    // guard is MADE of, so the guard is not yet recorded rather than 'none',
    // which would publicly deny the guard the old date says went in — and
    // the legacy date survives untouched: additive and lossless.
    expect(bed.guard).toBeNull();
    expect(bed.treePresent).toBeNull();
    expect(bed.plantsPresent).toBeNull();
    expect(bed.plantingRecommended).toBeNull();
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
    const data = seedData();
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
    const data = seedData();
    data.blocks[W171_BLOCK_ID]!.referenceAddress = '710 W 171st St';
    data.beds[W171_PLATE]!.offeredSlots = 1;
    ensureCheckedInBlocks(data);
    expect(data.blocks[W171_BLOCK_ID]!.referenceAddress).toBe('710 W 171st St');
    expect(data.beds[W171_PLATE]!.offeredSlots).toBe(1);
  });
});

describe('the panel’s three-way radios, as form values', () => {
  it('reads a pick, the NOT RECORDED choice, and a form with no radio apart', () => {
    // Three outcomes, because two of them are different acts: unrecording is
    // something the captain chooses, and an absent radio is a stale page.
    expect(guardMaterialFrom('metal')).toBe('metal');
    expect(guardMaterialFrom(UNRECORDED_CHOICE)).toBeNull();
    expect(guardMaterialFrom(null)).toBeUndefined();
    expect(guardMaterialFrom('brick')).toBeUndefined();

    expect(bedFactFrom('yes')).toBe(true);
    expect(bedFactFrom('no')).toBe(false);
    expect(bedFactFrom(UNRECORDED_CHOICE)).toBeNull();
    expect(bedFactFrom(null)).toBeUndefined();
    expect(bedFactFrom('maybe')).toBeUndefined();
  });
});

describe('the admin sees a bed’s open report', () => {
  const report = (store: LocalStore, actorId: string, categories: Array<'litter' | 'other'>, note = '') =>
    reportProblem(store, { plate: W171_PLATE, actorId, categories, note, photoAttached: false });
  const openedBed = async (store: LocalStore) =>
    (await getBlockView(store, W171_BLOCK_ID, W171_PLATE))!.beds.find(
      (b) => b.bed.plate === W171_PLATE,
    )!;
  const opened = async (store: LocalStore) => (await openedBed(store)).openReport;

  it('carries the open report — what was picked, the note, and the weight added to it', async () => {
    const store = freshStore();
    expect(await opened(store)).toBeNull();

    await report(store, 'visitor-a', ['litter', 'other'], 'bolsas en la esquina');
    const filed = await opened(store);
    expect(filed?.categories).toEqual(['litter', 'other']);
    expect(filed?.note).toBe('bolsas en la esquina');
    expect(filed?.confirmedBy).toEqual([]);

    // A second neighbour adds weight rather than a second report, and the
    // panel reads the same one with their weight on it.
    await report(store, 'visitor-b', ['litter']);
    const weighted = await opened(store);
    expect(weighted?.id).toBe(filed?.id);
    expect(weighted?.confirmedBy).toEqual(['visitor-b']);
  });

  it('carries what the confirming neighbours said, joined by the report id', async () => {
    // The steward reads these on their own view and the public FAQ says we
    // see the report: the captain's surface must not see less of one.
    const store = freshStore();
    await report(store, 'visitor-a', ['litter'], 'bolsas en la esquina');
    await report(store, 'visitor-b', ['other'], 'the guard is loose');
    expect((await openedBed(store)).openReportConfirms).toEqual([
      { categories: ['other'], note: 'the guard is loose' },
    ]);

    // A later lap is its own report, so the earlier lap's words never ride on it.
    const open = (await opened(store))!;
    await store.transaction(async (tx) => {
      await tx.updateReport({ ...open, closedAt: new Date().toISOString(), closedBy: 'steward' });
    });
    await report(store, 'visitor-c', ['litter']);
    expect((await openedBed(store)).openReportConfirms).toEqual([]);
  });

  it('resolves the open report only for the bed the page has open', async () => {
    const store = freshStore();
    await report(store, 'visitor-a', ['litter'], 'bolsas');
    const unopened = (await getBlockView(store, W171_BLOCK_ID, null))!.beds.find(
      (b) => b.bed.plate === W171_PLATE,
    )!;
    expect(unopened.openReport).toBeNull();
    expect(unopened.openReportConfirms).toEqual([]);
  });

  it('reads nothing once the report is closed, and never touches it', async () => {
    const store = freshStore();
    const { report: filed } = await report(store, 'visitor-a', ['litter']);
    await store.transaction(async (tx) => {
      await tx.updateReport({ ...filed!, closedAt: new Date().toISOString(), closedBy: 'steward' });
    });
    expect(await opened(store)).toBeNull();
    expect((await store.getReports(W171_PLATE)).map((r) => r.id)).toEqual([filed!.id]);
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
    const save = (guard: 'none' | 'wood' | 'metal' | null | undefined) =>
      saveBlockSettings(store, {
        blockId: W171_BLOCK_ID,
        referenceAddress: '',
        bed: bedSave({ guard, careNote: 'Water on hot weeks.' }),
      });
    // A form that carried no radio on a bed nobody has recorded keeps it so.
    await save(undefined);
    expect((await store.getBed(W171_PLATE))!.guard).toBeNull();
    await save('wood');
    expect((await store.getBed(W171_PLATE))!.guard).toBe('wood');
    // A form that omits the radio never blanks a material on record.
    await save(undefined);
    expect((await store.getBed(W171_PLATE))!.guard).toBe('wood');
    // The panel's own NOT RECORDED choice does take it back, so a mis-tap on
    // the street is undoable rather than published for good.
    await save(null);
    expect((await store.getBed(W171_PLATE))!.guard).toBeNull();
    await save('metal');
    expect((await store.getBed(W171_PLATE))!.guard).toBe('metal');
    await save('none');
    const off = (await store.getBed(W171_PLATE))!;
    expect(off.guard).toBe('none');
    // The rest of the press rode along: the guard choice never costs a note.
    expect(off.careNote).toBe('Water on hot weeks.');
  });

  it('keeps a typed note on the record when its switch is turned off, so switching back restores it', async () => {
    const store = freshStore();
    const save = (plantsPresent: boolean | null, plantingRecommended: boolean | null) =>
      saveBlockSettings(store, {
        blockId: W171_BLOCK_ID,
        referenceAddress: '',
        bed: bedSave({
          plantsPresent,
          plantingRecommended,
          plantsNote: 'Daffodils and a hosta',
          recommendedPlantsNote: 'Swamp milkweed',
        }),
      });
    await save(true, true);
    await save(false, false);
    const off = (await store.getBed(W171_PLATE))!;
    expect(off.plantsPresent).toBe(false);
    expect(off.plantingRecommended).toBe(false);
    expect(off.plantsNote).toBe('Daffodils and a hosta');
    expect(off.recommendedPlantsNote).toBe('Swamp milkweed');
  });

  it('keeps the profile facts as they stand when a form carried no radio', async () => {
    // The guard's rule, applied to the two facts that read the same way: a
    // seeded bed nobody has recorded stays not-yet-recorded, and a fact on
    // record is never blanked by a form that omitted the radio.
    const store = freshStore();
    const save = (
      plantsPresent: boolean | null | undefined,
      plantingRecommended: boolean | null | undefined,
    ) =>
      saveBlockSettings(store, {
        blockId: W171_BLOCK_ID,
        referenceAddress: '',
        bed: bedSave({ plantsPresent, plantingRecommended }),
      });
    await save(undefined, undefined);
    const untouched = (await store.getBed(W171_PLATE))!;
    expect(untouched.plantsPresent).toBeNull();
    expect(untouched.plantingRecommended).toBeNull();

    await save(true, false);
    await save(undefined, undefined);
    const kept = (await store.getBed(W171_PLATE))!;
    expect(kept.plantsPresent).toBe(true);
    expect(kept.plantingRecommended).toBe(false);
  });

  it('takes a recorded profile fact back to not-yet-recorded on the NOT RECORDED choice', async () => {
    // Every three-way row offers it, because the captain records these
    // one-handed on a sidewalk: a mis-tap must not publish an unverified
    // fact for good, and the absence of a radio is already spoken for.
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ plantsPresent: true, plantingRecommended: true }),
    });
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ plantsPresent: null, plantingRecommended: null }),
    });
    const unrecorded = (await store.getBed(W171_PLATE))!;
    expect(unrecorded.plantsPresent).toBeNull();
    expect(unrecorded.plantingRecommended).toBeNull();
  });

  it('keeps every profile field a form did not carry, rather than blanking it', async () => {
    // One rule for the whole profile: a stale page or a hand-built POST that
    // carries no radio and no textarea changes nothing. The facts already
    // read `undefined` as keep-as-it-stands; the notes and the tree — which a
    // checkbox could not tell "unchecked" from "not sent" — do too.
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({
        treePresent: true,
        plantsPresent: true,
        plantingRecommended: true,
        plantsNote: 'Daffodils along the guard side.',
        recommendedPlantsNote: 'Swamp milkweed.',
        careNote: 'Water twice a week.',
      }),
    });
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave(),
    });
    const bed = (await store.getBed(W171_PLATE))!;
    expect(bed.treePresent).toBe(true);
    expect(bed.plantsPresent).toBe(true);
    expect(bed.plantingRecommended).toBe(true);
    expect(bed.plantsNote).toBe('Daffodils along the guard side.');
    expect(bed.recommendedPlantsNote).toBe('Swamp milkweed.');
    expect(bed.careNote).toBe('Water twice a week.');
  });

  it('takes the tree back to NOT RECORDED on the choice, like the guard', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ treePresent: false }),
    });
    expect((await store.getBed(W171_PLATE))!.treePresent).toBe(false);
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ treePresent: null }),
    });
    expect((await store.getBed(W171_PLATE))!.treePresent).toBeNull();
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
        // Typed fields go through `capped`: the bidi overrides are stripped,
        // control characters and whitespace runs — the CRLF a textarea submits
        // for Enter included — collapse to one space, then the bound cuts what
        // remains.
        plantsNote: `  Daffodils and‮ a hosta  `,
        recommendedPlantsNote: 'x'.repeat(500),
        careNote: 'Litter pickup\r\nafter\tweekends.\n\nRake in fall.',
      }),
    });
    const bed = (await store.getBed(W171_PLATE))!;
    expect(bed.treePresent).toBe(false);
    expect(bed.plantsPresent).toBe(true);
    expect(bed.plantingRecommended).toBe(true);
    expect(bed.plantsNote).toBe('Daffodils and a hosta');
    expect(bed.recommendedPlantsNote).toHaveLength(MAX_BED_NOTE_CHARS);
    expect(bed.careNote).toBe('Litter pickup after weekends. Rake in fall.');

    // A submitted-but-empty textarea still clears: keep-as-it-stands is about
    // a field that never arrived, not one the captain emptied on purpose.
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ careNote: '' }),
    });
    expect((await store.getBed(W171_PLATE))!.careNote).toBe('');
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
    expect(user.hasSignInRoute).toBe(false);
    expect(user.recordHeldOnBehalf).toBe(true);
    // The handle is generated, the same <Word>Steward<number> shape the tap
    // adopt flow hands out -- pen and paper is not a second-class signup.
    expect(user.username).toMatch(GENERATED_USERNAME_RE);
    const view = await getBlockView(store, W171_BLOCK_ID);
    const bed = view!.beds.find((b) => b.bed.plate === W171_PLATE)!;
    expect(bed.stewards).toHaveLength(1);
    expect(bed.stewards[0]!.adoption.stewardKind).toBe('pen-and-paper');
  });

  it('gives a written-in steward with an email the same emailed sign-in route as anyone else', async () => {
    // Sign-in is the emailed link, so an email on the admin form IS a
    // sign-in route — pen-and-paper stewards included — while the record is
    // still held on their behalf.
    const store = freshStore();
    const user = await addStewardByAdmin(store, {
      plate: W171_PLATE,
      input: stewardInput({ email: 'dani@example.com' }),
      lang: 'es',
    });
    expect(user.hasSignInRoute).toBe(true);
    expect(user.recordHeldOnBehalf).toBe(true);
    expect(user.lang).toBe('es');
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

  it('rolls a fresh handle past one the store already holds', async () => {
    // Pin the rng so every random roll is the same candidate: the first
    // steward takes it, and the second must be walked to the next free one
    // inside the transaction rather than written as a duplicate.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const store = freshStore();
      const first = await addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() });
      expect(first.username).toBe('MapleSteward10');
      const second = await addStewardByAdmin(store, {
        plate: 'BED-WH-1712',
        input: stewardInput({ firstName: 'Luz', lastName: 'Vega' }),
      });
      expect(second.username).toBe('OakSteward10');
    } finally {
      spy.mockRestore();
    }
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

  it('keeps a typed handle as typed and still folds case on collision', async () => {
    // A typed handle may take the generated shape verbatim -- the store holds
    // one handle alphabet -- and lookups fold case, so a differently-cased
    // spelling of an existing handle is the same handle, refused not stored.
    const store = freshStore();
    const typed = await addStewardByAdmin(store, {
      plate: W171_PLATE,
      input: stewardInput({ username: '@MapleSteward42' }),
    });
    expect(typed.username).toBe('MapleSteward42');
    expect(await store.getUserByUsername('maplesteward42')).toMatchObject({ id: typed.id });
    await expect(
      addStewardByAdmin(store, {
        plate: 'BED-WH-1712',
        input: stewardInput({ firstName: 'Delia', username: 'MAPLESTEWARD42' }),
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(validateAdminStewardInput(stewardInput({ username: 'DTorres' })).values.username).toBe(
      'DTorres',
    );
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

describe('deleting a bed', () => {
  it('retires the bed rather than erasing it: the list drops it, every record keyed to the plate survives', async () => {
    const store = freshStore();
    // A live bed: a steward on it and a report open against it.
    await addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() });
    const outcome = await reportProblem(store, {
      plate: W171_PLATE,
      actorId: 'visitor-1',
      categories: ['litter'],
      note: '',
      photoAttached: false,
    });
    expect(outcome.kind).toBe('filed');

    await retireBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: W171_PLATE });

    // Gone from the admin list and from every screen read…
    const view = await getBlockView(store, W171_BLOCK_ID);
    expect(view!.beds.map((b) => b.bed.plate)).not.toContain(W171_PLATE);
    expect(await getBedView(store, W171_PLATE)).toBeNull();

    // …but nothing keyed to the plate was destroyed or orphaned.
    const row = await store.getBed(W171_PLATE);
    expect(row).not.toBeNull();
    expect(row!.retiredAt).not.toBeNull();
    expect(await store.getActiveAdoptions(W171_PLATE)).toHaveLength(1);
    expect((await store.getReports(W171_PLATE)).map((r) => r.id)).toEqual([outcome.report!.id]);
    expect((await store.getEvents(W171_PLATE, 'adopt')).length).toBe(1);
    expect((await store.getEvents(W171_PLATE, 'report')).length).toBe(1);
  });

  it('is idempotent: a resubmitted confirmation keeps the original date', async () => {
    const store = freshStore();
    await retireBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: W171_PLATE });
    const retiredAt = (await store.getBed(W171_PLATE))!.retiredAt;
    await retireBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: W171_PLATE });
    expect((await store.getBed(W171_PLATE))!.retiredAt).toBe(retiredAt);
  });

  it('refuses a plate outside the named block', async () => {
    await expect(
      retireBedByAdmin(freshStore(), { blockId: DEMO_BLOCK_ID, plate: W171_PLATE }),
    ).rejects.toMatchObject({ code: 'bed-not-found' });
  });

  it('answers not-found to every street and admin write once retired', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ guard: 'none', offeredSlotNumbers: [1] }),
    });
    await retireBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: W171_PLATE });
    const notFound = { code: 'bed-not-found' };
    await expect(
      reportProblem(store, {
        plate: W171_PLATE,
        actorId: 'visitor-1',
        categories: ['litter'],
        note: '',
        photoAttached: false,
      }),
    ).rejects.toMatchObject(notFound);
    await expect(
      adoptBed(store, {
        plate: W171_PLATE,
        input: { firstName: 'Rita', lastName: 'Okafor', email: 'r@example.com', phone: '' },
      }),
    ).rejects.toMatchObject(notFound);
    await expect(
      sendApplause(store, { plate: W171_PLATE, actorId: 'visitor-1' }),
    ).rejects.toMatchObject(notFound);
    await expect(
      addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() }),
    ).rejects.toMatchObject(notFound);
    await expect(
      saveBlockSettings(store, {
        blockId: W171_BLOCK_ID,
        referenceAddress: '',
        bed: bedSave({ guard: 'metal' }),
      }),
    ).rejects.toMatchObject(notFound);
  });

  it('stays deleted through the checked-in seed backfill — the trap that rules out erasing the row', async () => {
    // `ensureCheckedInBlocks` re-inserts a MISSING seeded bed on every load,
    // so a hard delete of one of the six would quietly resurrect. The
    // tombstone occupies the key, and insert-only means it is never touched.
    const data = seedData();
    data.beds[W171_PLATE]!.retiredAt = '2026-09-10T12:00:00.000Z';
    ensureCheckedInBlocks(data);
    expect(data.beds[W171_PLATE]!.retiredAt).toBe('2026-09-10T12:00:00.000Z');

    // And a record from before the field existed simply was never deleted.
    const legacy = data.beds['BED-WH-1712']! as unknown as Record<string, unknown>;
    delete legacy.retiredAt;
    normalizeData(data);
    expect(data.beds['BED-WH-1712']!.retiredAt).toBeNull();
  });

  it('continues the plate series and positions past a deleted bed rather than reusing them', async () => {
    const store = freshStore();
    await retireBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: 'BED-WH-1716' });
    const bed = await addBedByAdmin(store, {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Pin oak', es: 'Roble palustre' },
    });
    expect(bed.plate).toBe('BED-WH-1717');
    expect(bed.blockPosition).toBe(7);
  });
});

describe('restoring a deleted bed', () => {
  it('hands the bed and its tag back exactly as they were, stewards and reports intact', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ guard: 'metal', offeredSlotNumbers: [1], addSlots: 1 }),
    });
    await addStewardByAdmin(store, { plate: W171_PLATE, input: stewardInput() });
    const outcome = await reportProblem(store, {
      plate: W171_PLATE,
      actorId: 'visitor-1',
      categories: ['litter'],
      note: '',
      photoAttached: false,
    });
    const before = await store.getBed(W171_PLATE);

    await retireBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: W171_PLATE });
    // The list holds it apart while it is deleted — that is what the page
    // draws the RESTORE control from.
    const deleted = await getBlockView(store, W171_BLOCK_ID);
    expect(deleted!.beds.map((b) => b.bed.plate)).not.toContain(W171_PLATE);
    expect(deleted!.retired.map((b) => b.plate)).toEqual([W171_PLATE]);

    await restoreBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: W171_PLATE });

    // Byte for byte the bed that was deleted: the guard, slots, offered
    // slots, NYC identifiers — only `retiredAt` ever moved.
    expect(await store.getBed(W171_PLATE)).toEqual(before);
    const view = await getBlockView(store, W171_BLOCK_ID);
    expect(view!.retired).toEqual([]);
    expect(view!.beds.map((b) => b.bed.plate)).toContain(W171_PLATE);

    // And the screens the still-bound tag reaches resolve again, with the
    // steward and the open report the bed had before the delete.
    const bedView = await getBedView(store, W171_PLATE);
    expect(bedView).not.toBeNull();
    expect(bedView!.stewards).toHaveLength(1);
    expect(bedView!.openReport!.id).toBe(outcome.report!.id);
    expect(bedView!.bed.guard).toBe(before!.guard);
    expect(bedView!.bed.offeredSlots).toBe(before!.offeredSlots);
  });

  it('is a no-op on a bed that is not deleted, and refuses a plate outside the block', async () => {
    const store = freshStore();
    const before = await store.getBed(W171_PLATE);
    await restoreBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: W171_PLATE });
    expect(await store.getBed(W171_PLATE)).toEqual(before);

    await retireBedByAdmin(store, { blockId: W171_BLOCK_ID, plate: W171_PLATE });
    await expect(
      restoreBedByAdmin(store, { blockId: DEMO_BLOCK_ID, plate: W171_PLATE }),
    ).rejects.toMatchObject({ code: 'bed-not-found' });
    expect((await store.getBed(W171_PLATE))!.retiredAt).not.toBeNull();
  });
});

describe('the panel’s species row', () => {
  // The 22 named-run beds seed with no species at all (checked-in-beds.ts,
  // "i will update it to match NYC parks"), so this row is the only way the
  // captain records one — and it must read like the add-bed form, because
  // both go through `resolveSpecies`.
  const RUN_PLATE = '5SHFW171';

  it('records a species on a bed that had none, filling the Spanish from the table', async () => {
    const store = freshStore();
    expect((await store.getBed(RUN_PLATE))!.treeType).toBeNull();

    await saveBlockSettings(store, {
      blockId: SOUTH_RUN_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ plate: RUN_PLATE, treeType: { en: 'Willow oak', es: '' } }),
    });
    const bed = await store.getBed(RUN_PLATE);
    expect(bed!.treeType).toEqual({ en: 'Willow oak', es: 'roble sauce' });
  });

  it('lets a typed Spanish name win, and stores the table’s own name lowercase', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: SOUTH_RUN_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ plate: RUN_PLATE, treeType: { en: 'Pin oak', es: 'Mi roble favorito' } }),
    });
    expect((await store.getBed(RUN_PLATE))!.treeType!.es).toBe('Mi roble favorito');

    await saveBlockSettings(store, {
      blockId: SOUTH_RUN_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ plate: RUN_PLATE, treeType: { en: 'Willow oak', es: 'Roble Sauce' } }),
    });
    // Mid-sentence in the door frame, so the table's own name is stored
    // the way that sentence needs it.
    expect((await store.getBed(RUN_PLATE))!.treeType!.es).toBe('roble sauce');
  });

  it('degrades an unknown species to the generic wording rather than guessing', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: SOUTH_RUN_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ plate: RUN_PLATE, treeType: { en: 'Dragon tree', es: '' } }),
    });
    expect((await store.getBed(RUN_PLATE))!.treeType).toEqual({
      en: 'Dragon tree',
      es: 'árbol',
    });
  });

  it('keeps the species a form did not carry, and takes it back on a cleared name', async () => {
    const store = freshStore();
    const before = (await store.getBed(W171_PLATE))!.treeType;
    expect(before).not.toBeNull();

    // A partial POST blanks nothing — the same rule as every profile field.
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ guard: 'wood' }),
    });
    expect((await store.getBed(W171_PLATE))!.treeType).toEqual(before);

    // A cleared English name is the way back to NOT YET RECORDED, never an
    // empty word inside the door frame.
    await saveBlockSettings(store, {
      blockId: W171_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({ treeType: { en: '   ', es: 'roble sauce' } }),
    });
    expect((await store.getBed(W171_PLATE))!.treeType).toBeNull();
  });

  it('caps a typed species like every other typed field', async () => {
    const store = freshStore();
    await saveBlockSettings(store, {
      blockId: SOUTH_RUN_BLOCK_ID,
      referenceAddress: '',
      bed: bedSave({
        plate: RUN_PLATE,
        treeType: { en: 'x'.repeat(200), es: 'y'.repeat(200) },
      }),
    });
    const bed = await store.getBed(RUN_PLATE);
    expect(bed!.treeType!.en).toHaveLength(MAX_TREE_TYPE_CHARS);
    expect(bed!.treeType!.es).toHaveLength(MAX_TREE_TYPE_CHARS);
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
    expect(bed.treeType!.es).toBe('roble palustre');
  });

  it('fills the Spanish name from the species table when the admin leaves it blank', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: '  willow   oak ', es: '' },
    });
    // The English name is what was typed, through `capped` — whitespace runs
    // collapse to one space; the Spanish resolves through the table's tolerant
    // match, which tolerates the run either way.
    expect(bed.treeType!.en).toBe('willow oak');
    expect(bed.treeType!.es).toBe('roble sauce');
  });

  it('degrades an unknown species to the generic wording rather than guessing', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Dragon tree', es: '' },
    });
    expect(bed.treeType!.en).toBe('Dragon tree');
    // Never the English name and never a transliteration: "árbol" is the
    // same wording normalizeData gives a bed with no tree type at all.
    expect(bed.treeType!.es).toBe('árbol');
  });

  it('lets an explicitly supplied Spanish name win over the table', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Pin oak', es: 'Roble de los pantanos' },
    });
    expect(bed.treeType!.es).toBe('Roble de los pantanos');
  });

  it('normalizes a typed name that is the table’s own shouted, so the door sentence reads', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Willow oak', es: 'Roble Sauce' },
    });
    // "El cantero de este roble sauce…" — mid-sentence, so lowercase.
    expect(bed.treeType!.es).toBe('roble sauce');
  });

  it('stores a genuinely different typed name byte-for-byte, casing included', async () => {
    const bed = await addBedByAdmin(freshStore(), {
      blockId: W171_BLOCK_ID,
      treeType: { en: 'Willow oak', es: 'Mi roble favorito' },
    });
    expect(bed.treeType!.es).toBe('Mi roble favorito');
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
