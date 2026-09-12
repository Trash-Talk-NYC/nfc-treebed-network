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
 * made the match look confident. The north side is all willow oaks; the empty
 * pits between beds 5 and 6 (retired trees) are NYC's, not ours, and are
 * deliberately not seeded — no tree, no guard coming, nothing to steward.
 *
 * That south-curb fit is IN DOUBT since 2026-09-12, when the captain named
 * two of these beds with N-run (north side) ids — BED-WH-1712 as 9NHFW171
 * and BED-WH-1713 as 8NHFW171. His word beats a geometry fit, and if the side
 * split was wrong for two rows the six-space count that made the whole match
 * look confident is no longer an argument. So every NYC identifier here now
 * awaits re-verification in the captain's own NYC Parks pass ("i will update
 * it to match NYC parks"). Until then nothing may null them, re-guess them or
 * shuffle them between rows: resolved-or-null, never invented, still stands,
 * and these were resolved. What changes is only how much this docstring may
 * be relied on — read it as the method, not as a settled answer.
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
 * reason `tagUid` is empty and four of the six start unoffered
 * (`offeredSlots: 0`) until the captain opens them on the admin page — which
 * is the page's whole point. The exceptions are the two he renamed onto
 * N-run ids on 2026-09-12 (BED-WH-1712, BED-WH-1713): those seed offered,
 * with the plant facts he stated, because he opened them himself.
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
    /**
     * The two beds the captain identified as his named N-run ids carry what
     * he said about them — open for adoption and his plant facts — while the
     * other four keep the original not-yet-opened, nothing-recorded seed.
     * On the LIVE store these two rows already exist, so this reaches only
     * fresh stores. The live rows are ALREADY OPEN, verified against
     * production on 2026-09-12 after the PR-29 deploy: GET /t/1hc0t9cj and
     * GET /t/729v19w4 both served the ADOPT THIS BED button, which renders
     * only with an offered slot. Their plant facts travel by the
     * captain-facts remediation script (scripts/seed-captain-facts.mjs),
     * never by overwriting a stored row — and `offeredSlots` deliberately
     * does NOT, because 0 is a set value rather than NOT RECORDED and that
     * script may only fill what nobody has said.
     */
    captainNamed?: boolean;
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
    offeredSlots: args.captainNamed ? 1 : 0,
    guard: null,
    treePresent: null,
    plantsPresent: args.captainNamed ? false : null,
    plantsNote: '',
    plantingRecommended: args.captainNamed ? false : null,
    recommendedPlantsNote: '',
    careNote: '',
    blockId: W171_BLOCK_ID,
    blockPosition: args.position,
    applauseNoticeAt: null,
    applauseNoticeDueAt: null,
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
      // The bed the captain named 9NHFW171 (2026-09-12): tag `9nhfw171`
      // binds here beside the original `1hc0t9cj`, both live — he may
      // already have shared the old URL, and retiring it is his later call.
      // His N-side id on a bed the NYC-data analysis had fitted to the south
      // curb: his word wins over the fit; the header's side inference stands
      // corrected for this bed and BED-WH-1713 below, which puts the NYC
      // identifiers on both rows in doubt — they stay exactly as resolved and
      // await the captain's own NYC Parks pass, and nothing may null or
      // re-guess them meanwhile (see the header). Open for adoption and
      // "no plants, don't recommend planting" — his words, `captainNamed`.
      plate: 'BED-WH-1712',
      position: 2,
      plantingSpaceId: '2332470',
      plantingSpaceGlobalId: '7653DC67-36C3-4909-91A4-392CD6CE3371',
      treeId: '2135719',
      address: '718 W 171st St, New York, NY 10032',
      captainNamed: true,
    }),
    bed({
      // The bed the captain named 8NHFW171 (2026-09-12): tag `8nhfw171`
      // binds here beside the original `729v19w4`, both live — the same
      // story as BED-WH-1712 above, NYC identifiers awaiting the same
      // re-verification and untouched until it happens.
      plate: 'BED-WH-1713',
      position: 3,
      plantingSpaceId: '2332469',
      plantingSpaceGlobalId: '8CF6E9E0-C9CA-4025-AC77-2C3BFAD1AC41',
      treeId: '2135718',
      address: '708 W 171st St, New York, NY 10032',
      captainNamed: true,
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
 * The 20 FRESH beds of the captain's three named runs (2026-09-12), keyed by
 * the ids he chose: `1E170171HFW`–`6E170171HFW`, `1SHFW171`–`7SHFW171`, and
 * `1NHFW171`–`7NHFW171`. The id is the bed's PLATE and — lowercased — its
 * tag URL (`tag-bindings.ts`), by his decision: "it's supposed to be the url
 * actually and the bed id". See tag-id.ts for the opacity rule this
 * deliberately overrides.
 *
 * The N run spans NINE ids but mints only seven beds. `8NHFW171` and
 * `9NHFW171` are RENAMES of two beds the network already held, which the
 * captain identified standing at them (verbatim: "Can you change
 * …/t/1hc0t9cj for the end to be 9NHFW171 and then …/t/729v19w4 change to
 * 8NHFW171") — so those two ids bind to `BED-WH-1713` and `BED-WH-1712` in
 * `w171Beds` above, and minting them here would duplicate two real beds with
 * real NYC identities and real history. Do not "complete" the run.
 *
 * Everything about them is seeded UNASSERTED, because the captain will fill
 * the records in from NYC Parks' data ("i will update it to match NYC
 * parks"): NYC identifiers null — resolved or null, never invented — the
 * species NOT YET RECORDED (`treeType: null`; the doors degrade to the
 * generic tree), every three-way profile fact NOT YET RECORDED, no notes, no
 * address (his street numbers are loose cluster references, not locators).
 * The exceptions are only what the captain stated himself: the METAL guards
 * on `1NHFW171` and `2NHFW171` — their chips get the decorative `/m` suffix,
 * and seeding them unrecorded while the chip asserts metal would be exactly
 * the drift the guard field exists to prevent — and the plant facts on
 * `2SHFW171` and `5SHFW171` (see `captainFacts` below).
 *
 * Every bed opens with its one slot OFFERED (`offeredSlots: 1`), unlike the
 * four un-renamed W 171st beds above: "open all beds for adoption actually …
 * just want to get this ready for people to adopt and name."
 *
 * Which of the other four existing W 171st beds are physically among these
 * ids is still unsaid — the captain names them one by one, and his addresses
 * cannot (they are loose cluster references). The shape 8N/9N set is what a
 * later one follows: bind the named id to the EXISTING plate here and in
 * tag-bindings.ts, keep the old opaque tag live because the URL may already
 * be in somebody's hands, and never mint a fresh bed for it. Where a steward
 * has meanwhile landed on a duplicate record, `carryStewardByAdmin`
 * (service.ts / scripts/carry-steward.mjs) moves them keeping `adoptedAt`,
 * the duplicate record retires, and nothing keyed to either plate is lost.
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
    applauseNoticeDueAt: null,
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
  const beds = [
    ...run('E170171HFW', 6, HAVEN_EAST_RUN_BLOCK_ID, 'Haven Ave × W 170 St & W 171 St'),
    ...run('SHFW171', 7, SOUTH_RUN_BLOCK_ID, 'W 171 St × Fort Washington Ave & Haven Ave'),
    // 1N and 2N are the captain's two metal-guard beds — see the header.
    // The N run creates SEVEN fresh beds, not nine: the captain identified
    // 8NHFW171 and 9NHFW171 as two beds this network already held
    // (2026-09-12, verbatim: "Can you change …/t/1hc0t9cj for the end to be
    // 9NHFW171 and then …/t/729v19w4 change to 8NHFW171") — so those two
    // named ids bind to the existing records BED-WH-1713 and BED-WH-1712 in
    // `w171Beds` above (tag-bindings.ts carries the rows), and creating them
    // here as fresh beds would duplicate two real beds with real NYC
    // identities. Their `blockPosition` stays where the earlier record put
    // them; moving them between admin blocks is the captain's act, not a
    // seed's.
    ...run('NHFW171', 7, NORTH_RUN_BLOCK_ID, 'W 171 St × Fort Washington Ave & Haven Ave', [1, 2]),
  ];
  // The bed facts the captain stated himself (2026-09-12, verbatim: "say 2S
  // has plants say 5S doesn't and that we don't recommend planting") —
  // recorded because he said them, exactly as far as he said them: 2S gets
  // no planting recommendation and neither gets a note, because he gave
  // neither. His "with 8 and 9N say no plants and don't recommend planting"
  // lands on the two EXISTING beds those ids name, in `w171Beds` above.
  const captainFacts: Record<string, Partial<Bed>> = {
    '2SHFW171': { plantsPresent: true },
    '5SHFW171': { plantsPresent: false, plantingRecommended: false },
  };
  return beds.map((bed) => ({ ...bed, ...captainFacts[bed.plate] }));
}

/**
 * Make sure the checked-in blocks and every checked-in bed exist — the six
 * W 171st beds and the 20 fresh beds of the captain's three named runs (the
 * other two named ids are renames of W 171st beds already here) — on the way
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
