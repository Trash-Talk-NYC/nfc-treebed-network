// The captain's three named runs and their 22 beds (store-dataset.ts,
// `captainRunBeds`), as of his 2026-09-12 decision. What these hold:
//
//  - the bed id IS his id — plate `1E170171HFW` and its 21 siblings — and
//    every bed opens for adoption, because "just want to get this ready for
//    people to adopt and name";
//  - everything else seeds UNASSERTED: NYC identifiers null, the species and
//    every three-way profile fact NOT YET RECORDED — he will fill records in
//    from NYC Parks' data — with the one deliberate exception of the two
//    metal guards he named himself (1NHFW171, 2NHFW171);
//  - the six earlier W 171st beds and the seeded demo bed are untouched, and
//    an already-seeded store gains the runs additively, insert-only.

import { describe, expect, it } from 'vitest';

import {
  DEMO_BLOCK_ID,
  HAVEN_EAST_RUN_BLOCK_ID,
  NORTH_RUN_BLOCK_ID,
  SOUTH_RUN_BLOCK_ID,
  W171_BLOCK_ID,
  normalizeData,
  seedData,
} from '../src/lib/store-dataset';

const RUNS = [
  { block: HAVEN_EAST_RUN_BLOCK_ID, name: 'E170171HFW', count: 6 },
  { block: SOUTH_RUN_BLOCK_ID, name: 'SHFW171', count: 7 },
  { block: NORTH_RUN_BLOCK_ID, name: 'NHFW171', count: 9 },
] as const;

const RUN_PLATES = RUNS.flatMap(({ name, count }) =>
  Array.from({ length: count }, (_, i) => `${i + 1}${name}`),
);

describe('the 22 run beds in the seed', () => {
  it('exist under the captain’s ids, each open for adoption', () => {
    const { beds } = seedData();
    expect(RUN_PLATES).toHaveLength(22);
    for (const plate of RUN_PLATES) {
      const bed = beds[plate];
      expect(bed, plate).toBeDefined();
      expect(bed!.plate).toBe(plate);
      expect(bed!.slots).toBe(1);
      // "open all beds for adoption actually" — offered from the first load.
      expect(bed!.offeredSlots).toBe(1);
      expect(bed!.retiredAt).toBeNull();
    }
  });

  it('assert nothing the captain has not said: species, NYC ids and facts all unrecorded', () => {
    const { beds } = seedData();
    for (const plate of RUN_PLATES) {
      const bed = beds[plate]!;
      // Species NOT YET RECORDED — never the generic words stored as if
      // somebody entered them, and never a guess.
      expect(bed.treeType, plate).toBeNull();
      // NYC identifiers are resolved or null, never invented.
      expect(bed.plantingSpaceId, plate).toBeNull();
      expect(bed.plantingSpaceGlobalId, plate).toBeNull();
      expect(bed.treeId, plate).toBe('');
      expect(bed.treePresent, plate).toBeNull();
      expect(bed.plantsPresent, plate).toBeNull();
      expect(bed.plantingRecommended, plate).toBeNull();
      expect(bed.bedName, plate).toBeNull();
      // His street numbers are loose cluster references, not locators — so
      // no address is asserted at all.
      expect(bed.address, plate).toBe('');
    }
  });

  it('records the two metal guards the captain named, and only those', () => {
    const { beds } = seedData();
    for (const plate of RUN_PLATES) {
      const expected = plate === '1NHFW171' || plate === '2NHFW171' ? 'metal' : null;
      expect(beds[plate]!.guard, plate).toBe(expected);
    }
  });

  it('sits each run in its own labelled block, ordered by the id’s own number', () => {
    const data = seedData();
    for (const { block, name, count } of RUNS) {
      expect(data.blocks[block], block).toBeDefined();
      expect(data.blocks[block]!.demo).toBe(false);
      for (let n = 1; n <= count; n++) {
        const bed = data.beds[`${n}${name}`]!;
        expect(bed.blockId).toBe(block);
        expect(bed.blockPosition).toBe(n);
      }
    }
    // The run labels tell the three apart at a glance on the admin index —
    // the captain reads a label, not an id.
    expect(data.blocks[SOUTH_RUN_BLOCK_ID]!.referenceAddress).toContain('south side');
    expect(data.blocks[NORTH_RUN_BLOCK_ID]!.referenceAddress).toContain('north side');
    expect(data.blocks[HAVEN_EAST_RUN_BLOCK_ID]!.referenceAddress).toContain('Haven Ave');
  });

  it('touches neither the six earlier W 171st beds nor the demo bed', () => {
    const { beds } = seedData();
    for (let n = 1; n <= 6; n++) {
      const bed = beds[`BED-WH-171${n}`];
      expect(bed).toBeDefined();
      expect(bed!.blockId).toBe(W171_BLOCK_ID);
      // Still unoffered, still species-recorded — exactly as they seeded.
      expect(bed!.offeredSlots).toBe(0);
      expect(bed!.treeType).not.toBeNull();
    }
    expect(beds['BED-HRL-0847']!.blockId).toBe(DEMO_BLOCK_ID);
  });
});

describe('reaching an already-seeded store', () => {
  it('inserts the runs additively on the next load, insert-only by key', () => {
    // A live store from before 2026-09-12: no run blocks, no run beds.
    const data = seedData();
    for (const plate of RUN_PLATES) delete data.beds[plate];
    for (const { block } of RUNS) delete data.blocks[block];

    normalizeData(data);

    expect(Object.keys(data.beds)).toEqual(expect.arrayContaining(RUN_PLATES));
    for (const { block } of RUNS) expect(data.blocks[block]).toBeDefined();
  });

  it('never overwrites what the captain has since edited on the admin page', () => {
    const data = seedData();
    // He filled the species in from NYC Parks and closed the bed again.
    data.beds['4SHFW171']!.treeType = { en: 'Pin oak', es: 'roble palustre' };
    data.beds['4SHFW171']!.offeredSlots = 0;
    data.blocks[SOUTH_RUN_BLOCK_ID]!.referenceAddress = '711 W 171st St';

    normalizeData(data);

    expect(data.beds['4SHFW171']!.treeType).toEqual({ en: 'Pin oak', es: 'roble palustre' });
    expect(data.beds['4SHFW171']!.offeredSlots).toBe(0);
    expect(data.blocks[SOUTH_RUN_BLOCK_ID]!.referenceAddress).toBe('711 W 171st St');
  });

  it('reads a stored bed with no species as NOT YET RECORDED, not as the generic words', () => {
    const data = seedData();
    delete (data.beds['1SHFW171'] as { treeType?: unknown }).treeType;
    normalizeData(data);
    expect(data.beds['1SHFW171']!.treeType).toBeNull();
  });
});
