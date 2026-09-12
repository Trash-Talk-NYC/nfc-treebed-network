// The blocks and beds that are CHECKED IN rather than stored — the captain's
// real streets — and the insert-only pass that puts them into a dataset.
//
// Why it is its own module and not part of store-dataset.ts: the live-store
// remediation scripts are plain `.mjs` run by bare `node`, which resolves a
// `.ts` import only when every import below it names its file extension.
// store-dataset.ts does not (it reaches store.ts, types.ts and problem.ts
// without extensions), so a script could not read the seed through it — and
// a script that cannot see the checked-in records refuses to find a bed that
// simply has not been persisted yet, which is exactly the day-one case
// `scripts/carry-steward.mjs` exists for. Everything imported here is
// type-only (erased by Node's type stripping), and must stay that way —
// steward-carry.ts and store-keys.ts record the same constraint.
//
// These records are the SOURCE for what the chips carry (tag-bindings.ts):
// they were minted here ahead of the guards going in, so a mismatch between
// a row and a tag is repaired by re-encoding the tag, never by editing a row.

import type { Bed, Block } from './types';

/**
 * The parts of a dataset the checked-in records are inserted into. Structural
 * rather than `Data` itself, so a raw revision a script has read out of Blobs
 * satisfies it exactly as the store's own dataset does.
 */
export interface CheckedInTarget {
  beds: Record<string, Bed>;
  blocks: Record<string, Block>;
}

/** The captain's block: W 171st between Fort Washington and Haven. */
export const W171_BLOCK_ID = 'w-171-fort-washington-haven';

/** The pilot demo bed's own block, so it never sits inside a real street. */
export const DEMO_BLOCK_ID = 'w-138-acp-demo';

/**
 * The captain's three named runs (2026-09-12), one block each — a block is
 * one side of one street, and these are three real sidewalks he confirmed:
 * the south and north sides of W 171st between Haven and Fort Washington,
 * and the east sidewalk of Haven Ave between W 170th and W 171st. The
 * reference addresses are RUN LABELS rather than street numbers, so the
 * admin index tells the runs apart at a glance — the captain's own street
 * numbers are loose cluster references, his words, not locators, and he can
 * retype these in place like any block heading.
 */
export const SOUTH_RUN_BLOCK_ID = 'w-171-hfw-south';
export const NORTH_RUN_BLOCK_ID = 'w-171-hfw-north';
export const HAVEN_EAST_RUN_BLOCK_ID = 'haven-east-170-171';

export function checkedInBlocks(): Block[] {
  return [
    {
      id: W171_BLOCK_ID,
      // The captain's own words for the block; typed and editable in admin.
      referenceAddress: '708 W 171st St',
      demo: false,
      createdAt: '2026-09-10T00:00:00.000Z',
    },
    {
      id: SOUTH_RUN_BLOCK_ID,
      referenceAddress: 'S run · W 171 St, south side (Haven–Fort Washington)',
      demo: false,
      createdAt: '2026-09-12T00:00:00.000Z',
    },
    {
      id: NORTH_RUN_BLOCK_ID,
      referenceAddress: 'N run · W 171 St, north side (Haven–Fort Washington)',
      demo: false,
      createdAt: '2026-09-12T00:00:00.000Z',
    },
    {
      id: HAVEN_EAST_RUN_BLOCK_ID,
      referenceAddress: 'E run · Haven Ave, east side (W 170–W 171)',
      demo: false,
      createdAt: '2026-09-12T00:00:00.000Z',
    },
    {
      id: DEMO_BLOCK_ID,
      referenceAddress: '2300 Adam Clayton Powell Jr Blvd',
      demo: true,
      createdAt: '2026-09-10T00:00:00.000Z',
    },
  ];
}

/**
 * The six real beds on the south side of W 171st between Fort Washington and
 * Haven — five willow oaks and one white oak, exactly as the captain walked
 * it.
 *
 * Every NYC identifier below is RESOLVED, not invented: each bed was matched
 * to a record in NYC Parks' Forestry Planting Spaces open data (`82zj-84is`;
 * `plantingSpaceId` is its `objectid`, `plantingSpaceGlobalId` its stable
 * `globalid`) and its tree to Forestry Tree Points (`hn5i-inap`; `treeId` is
 * the tree point's `objectid`), queried 2026-09-10. How: all planting spaces
 * on the block were pulled by street/cross-street and by a geometry bounding
 * box, split into the two curb lines by fitting the point geometry to each
 * side, and joined to their tree points for species. The south (708) side
 * carries exactly six Populated spaces whose living trees are five
 * `Quercus phellos` (willow oak) and one `Quercus alba` (white oak) — the
 * only combination on the block matching the captain's count, which is what
 * makes the match confident. The north side is all willow oaks; the empty
 * pits between beds 5 and 6 (retired trees) are NYC's, not ours, and are
 * deliberately not seeded — no tree, no guard coming, nothing to steward.
 *
 * `blockPosition` is physical: 1 at the Haven end, 6 at the Fort Washington
 * corner, ordered by the records' own point geometry along the street. The
 * white oak therefore sits at position 5, not at the end the mockup guessed —
 * the corner willow oak (a bed wrapped around 255 Fort Washington Ave, on the
 * W 171st curb line) is past it.
 *
 * Five guards are ordered in the real world — one per willow oak, none for
 * the white oak — and none is installed today, but every bed seeds
 * `guard: null` (not yet recorded) rather than 'none': tags go in WITH the
 * guards (tag-bindings.ts), so by the time anyone can tap a W 171st bed a
 * guard is standing there, and the public screen must not say otherwise until
 * the captain has recorded the material on the admin page. For the same
 * reason `tagUid` is empty and every bed starts unoffered (`offeredSlots: 0`)
 * until the captain opens it on the admin page — which is the page's whole
 * point.
 */
export function w171Beds(): Bed[] {
  const LOOKED_UP_AT = '2026-09-10T00:00:00.000Z';
  const bed = (args: {
    plate: string;
    position: number;
    plantingSpaceId: string;
    plantingSpaceGlobalId: string;
    treeId: string;
    whiteOak?: boolean;
    address: string;
  }): Bed => ({
    plate: args.plate,
    plantingSpaceId: args.plantingSpaceId,
    plantingSpaceGlobalId: args.plantingSpaceGlobalId,
    treeType: args.whiteOak
      ? { en: 'white oak', es: 'roble blanco' }
      : { en: 'willow oak', es: 'roble sauce' },
    treeId: args.treeId,
    bedName: null,
    tagUid: '',
    crossStreets: 'W 171 St × Fort Washington Ave & Haven Ave',
    address: args.address,
    slots: 1,
    offeredSlots: 0,
    guard: null,
    treePresent: null,
    plantsPresent: null,
    plantsNote: '',
    plantingRecommended: null,
    recommendedPlantsNote: '',
    careNote: '',
    blockId: W171_BLOCK_ID,
    blockPosition: args.position,
    applauseNoticeAt: null,
    nycSyncedAt: LOOKED_UP_AT,
    nycMissingSince: null,
    retiredAt: null,
  });
  return [
    // Haven end, walking toward Fort Washington. Willow oaks 1–4 front
    // 718 and 708 W 171st.
    bed({
      plate: 'BED-WH-1711',
      position: 1,
      plantingSpaceId: '2332471',
      plantingSpaceGlobalId: '4B3E910E-FE25-478F-8C31-8F651CAD934F',
      treeId: '2135720',
      address: '718 W 171st St, New York, NY 10032',
    }),
    bed({
      plate: 'BED-WH-1712',
      position: 2,
      plantingSpaceId: '2332470',
      plantingSpaceGlobalId: '7653DC67-36C3-4909-91A4-392CD6CE3371',
      treeId: '2135719',
      address: '718 W 171st St, New York, NY 10032',
    }),
    bed({
      plate: 'BED-WH-1713',
      position: 3,
      plantingSpaceId: '2332469',
      plantingSpaceGlobalId: '8CF6E9E0-C9CA-4025-AC77-2C3BFAD1AC41',
      treeId: '2135718',
      address: '708 W 171st St, New York, NY 10032',
    }),
    bed({
      plate: 'BED-WH-1714',
      position: 4,
      plantingSpaceId: '2332468',
      plantingSpaceGlobalId: 'D835F3F9-3AB0-48EE-ADDC-62617BB98CE6',
      treeId: '2135717',
      address: '708 W 171st St, New York, NY 10032',
    }),
    // The one white oak (Quercus alba, tree point 1019518, dbh 15) — fifth
    // along, in front of 708. No guard is on order for it.
    bed({
      plate: 'BED-WH-1715',
      position: 5,
      plantingSpaceId: '1188102',
      plantingSpaceGlobalId: '6E836E3B-A30B-4DE7-AC69-0A2D672656BB',
      treeId: '1019518',
      whiteOak: true,
      address: '708 W 171st St, New York, NY 10032',
    }),
    // The corner willow oak: NYC files it under 255 Fort Washington Ave, but
    // its point sits on the W 171st south curb line — it is this block's
    // easternmost bed, past the empty pits.
    bed({
      plate: 'BED-WH-1716',
      position: 6,
      plantingSpaceId: '2332466',
      plantingSpaceGlobalId: 'FD260C6C-3F93-4F4D-ACC8-33F4A783B2C8',
      treeId: '2135715',
      address: '255 Fort Washington Ave, New York, NY 10032',
    }),
  ];
}

/**
 * The 22 beds of the captain's three named runs (2026-09-12), keyed by the
 * ids he chose: `1E170171HFW`–`6E170171HFW`, `1SHFW171`–`7SHFW171`,
 * `1NHFW171`–`9NHFW171`. The id is the bed's PLATE and — lowercased — its
 * tag URL (`tag-bindings.ts`), by his decision: "it's supposed to be the url
 * actually and the bed id". See tag-id.ts for the opacity rule this
 * deliberately overrides.
 *
 * Everything about them is seeded UNASSERTED, because the captain will fill
 * the records in from NYC Parks' data ("i will update it to match NYC
 * parks"): NYC identifiers null — resolved or null, never invented — the
 * species NOT YET RECORDED (`treeType: null`; the doors degrade to the
 * generic tree), every three-way profile fact NOT YET RECORDED, no notes, no
 * address (his street numbers are loose cluster references, not locators).
 * The one exception is the guard on `1NHFW171` and `2NHFW171`: the captain
 * himself said those two carry METAL guards — their chips get the decorative
 * `/m` suffix — and seeding them unrecorded while the chip asserts metal
 * would be exactly the drift the guard field exists to prevent.
 *
 * Every bed opens with its one slot OFFERED (`offeredSlots: 1`), unlike the
 * six W 171st beds above: "open all beds for adoption actually … just want
 * to get this ready for people to adopt and name."
 *
 * The six existing W 171st beds are deliberately NOT mapped onto these ids.
 * Some of them are physically among these 22 — the captain has not yet said
 * which — so the day he stands at his tree and tells us, the steward moves
 * by `carryStewardByAdmin` (service.ts / scripts/carry-steward.mjs), the
 * duplicate record retires, and nothing keyed to either plate is lost.
 */
export function captainRunBeds(): Bed[] {
  const runBed = (args: {
    run: string;
    position: number;
    blockId: string;
    crossStreets: string;
    guard?: 'metal';
  }): Bed => ({
    plate: `${args.position}${args.run}`,
    plantingSpaceId: null,
    plantingSpaceGlobalId: null,
    treeType: null,
    treeId: '',
    bedName: null,
    tagUid: '',
    crossStreets: args.crossStreets,
    address: '',
    slots: 1,
    offeredSlots: 1,
    guard: args.guard ?? null,
    treePresent: null,
    plantsPresent: null,
    plantsNote: '',
    plantingRecommended: null,
    recommendedPlantsNote: '',
    careNote: '',
    blockId: args.blockId,
    blockPosition: args.position,
    applauseNoticeAt: null,
    nycSyncedAt: null,
    nycMissingSince: null,
    retiredAt: null,
  });
  const run = (
    name: string,
    count: number,
    blockId: string,
    crossStreets: string,
    metalPositions: readonly number[] = [],
  ): Bed[] =>
    Array.from({ length: count }, (_, i) =>
      runBed({
        run: name,
        position: i + 1,
        blockId,
        crossStreets,
        guard: metalPositions.includes(i + 1) ? 'metal' : undefined,
      }),
    );
  return [
    ...run('E170171HFW', 6, HAVEN_EAST_RUN_BLOCK_ID, 'Haven Ave × W 170 St & W 171 St'),
    ...run('SHFW171', 7, SOUTH_RUN_BLOCK_ID, 'W 171 St × Fort Washington Ave & Haven Ave'),
    // 1N and 2N are the captain's two metal-guard beds — see the header.
    ...run('NHFW171', 9, NORTH_RUN_BLOCK_ID, 'W 171 St × Fort Washington Ave & Haven Ave', [1, 2]),
  ];
}

/**
 * Make sure the checked-in blocks and every checked-in bed exist — the six
 * W 171st beds and the 22 beds of the captain's three named runs — on the way
 * past every load.
 *
 * The pilot store is LIVE and was seeded before this block existed; seeding
 * only ever runs on first contact and re-seeding over live data is refused by
 * design (AGENTS.md). So the captain's block reaches an already-seeded store
 * the same way a missing field does: additively, in the one place both
 * backends share. The rules that keep this safe are the same ones
 * `normalizeData` already lives by — a record is only ever INSERTED when its
 * key is absent, never overwritten, so everything the captain later edits on
 * the admin page (the reference address, a guard toggle, an opened slot)
 * survives every later load. Idempotent by construction.
 *
 * The demo bed is deliberately NOT placed in the captain's block: it gets its
 * own block, flagged `demo`, so the admin page can show it — it holds the
 * pilot's live history — without a fake bed ever reading as part of a real
 * street.
 *
 * Safe on a RAW revision as well as on a normalized dataset — the live-store
 * scripts run this before `normalizeData` ever has — so the two collections
 * it writes into are made to exist rather than assumed to.
 */
export function ensureCheckedInRecords(data: CheckedInTarget): void {
  data.beds ??= {};
  data.blocks ??= {};
  for (const block of checkedInBlocks()) {
    data.blocks[block.id] ??= block;
  }
  for (const bed of w171Beds()) {
    data.beds[bed.plate] ??= bed;
  }
  for (const bed of captainRunBeds()) {
    data.beds[bed.plate] ??= bed;
  }
  const demo = data.beds['BED-HRL-0847'];
  // `?? null`: this runs ahead of normalization, so a record written before
  // `blockId` existed carries undefined rather than null.
  if (demo && (demo.blockId ?? null) === null) {
    demo.blockId = DEMO_BLOCK_ID;
    demo.blockPosition = 1;
  }
}
