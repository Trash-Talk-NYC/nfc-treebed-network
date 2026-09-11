// The dataset every Store implementation persists, and the pure operations
// over it. This file knows nothing about *where* data lives — store-local.ts
// (a JSON file on disk) and store-blobs.ts (Netlify Blobs) each own their
// persistence and share this shape, the seed, and the operations, so the two
// backends cannot drift apart on what the data means.

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Store } from './store';
import type { ProblemCategory } from './problem';
import type { Adoption, Bed, BedEvent, Block, Report, User } from './types';

export interface Data {
  beds: Record<string, Bed>;
  blocks: Record<string, Block>;
  users: Record<string, User>;
  adoptions: Adoption[];
  reports: Report[];
  events: BedEvent[];
  reportCounter: number;
}

/** The demo PIN the seeded steward gets where sign-in is not publicly reachable. */
export const DEMO_STEWARD_PIN = '1234';

/**
 * Fill in fields a record predates.
 *
 * The pilot store is live and holds rows written before the tap flow's fields
 * existed — a bed with no planting space ID or tree type, a user with a single
 * `name`, a report with no category. Seeding only ever runs on first contact,
 * so those rows are never rewritten by a deploy, and the store deliberately has
 * no migration step (AGENTS.md: rotating a value forward is a hand procedure,
 * and re-seeding over live data is refused).
 *
 * So the shape is reconciled on the way in instead, once per load, in the one
 * place both backends share. Everything here is additive and lossless: nothing
 * is deleted, nothing is renamed away, and a record that already has the field
 * keeps its value. The same rule the NYC sync is held to.
 */
export function normalizeData(data: Data): Data {
  data.blocks ??= {};
  // Insert BEFORE the loops, so a freshly inserted checked-in record goes
  // through exactly the same normalization a stored one does: the next field
  // added to `Bed` or `Block` is then filled in for both, rather than only
  // for the stores that had already persisted these.
  ensureCheckedInBlocks(data);
  for (const bed of Object.values(data.beds)) normalizeBed(bed);
  for (const block of Object.values(data.blocks)) normalizeBlock(block);
  for (const user of Object.values(data.users)) normalizeUser(user);
  for (const adoption of data.adoptions) normalizeAdoption(adoption);
  for (const report of data.reports) normalizeReport(report);
  for (const event of data.events) normalizeEvent(event);
  return data;
}

function normalizeBed(bed: Bed): void {
  const legacy = bed as Bed & { treeType?: unknown };
  // A bed we hold that NYC's data has no number for prints no number at all.
  // Falling back to `plate` would put our own ID — which encodes site type and
  // neighbourhood — on a public screen.
  bed.plantingSpaceId ??= null;
  bed.plantingSpaceGlobalId ??= null;
  if (typeof legacy.treeType !== 'object' || legacy.treeType === null) {
    bed.treeType = { en: 'tree', es: 'árbol' };
  }
  // A bed written before naming existed is simply a bed nobody has named.
  bed.bedName ??= null;
  // A record from before the admin page's per-slot switches was written when
  // every unfilled slot was implicitly up for adoption — that is what the
  // door screen did with it — so `offeredSlots = slots` records what was
  // already true rather than closing a bed nobody closed.
  bed.offeredSlots ??= bed.slots;
  // Before the block admin, `guardInstalledAt` was a bare string: every bed
  // that existed had its guard in. Nothing to fill for those; a bed written
  // without the ordered date simply was never in the ordered state.
  bed.guardOrderedAt ??= null;
  bed.guardInstalledAt ??= null;
  bed.blockId ??= null;
  bed.blockPosition ??= null;
  bed.nycSyncedAt ??= null;
  bed.nycMissingSince ??= null;
}

function normalizeBlock(block: Block): void {
  block.demo ??= false;
}

function normalizeUser(user: User): void {
  // Before the first/last split, one `name` field held both — the gap the
  // approved screens call out ("Names are one field today").
  const legacy = user as User & { name?: string };
  if (typeof user.firstName !== 'string' || typeof user.lastName !== 'string') {
    const parts = (legacy.name ?? '').trim().split(/\s+/).filter(Boolean);
    user.firstName ??= parts[0] ?? '';
    user.lastName ??= parts.slice(1).join(' ');
  }
  user.pinHash ??= null;
  // A record that predates the pen-and-paper case was created by somebody
  // signing themselves up, which is exactly the state these two describe.
  user.hasSignInRoute ??= user.pinHash !== null;
  user.recordHeldOnBehalf ??= false;
}

function normalizeAdoption(adoption: Adoption): void {
  adoption.stewardKind ??= 'nfc';
  // A row written before the flag existed belongs to somebody who was never
  // offered the choice, and the screen engraved them — so `false` records what
  // is already true on the plaque rather than hiding a steward who never asked.
  adoption.displayNameHidden ??= false;
}

function normalizeEvent(event: BedEvent): void {
  // Events written before a `confirm` carried what the second neighbour said
  // have nothing to say; `events` is append-only, so this fills the shape in
  // on the way past rather than rewriting the row. An event from before the
  // picker went multi-select carried one nullable `category`: it becomes the
  // one-entry (or empty) list it always meant, and the stored field is left
  // in place rather than deleted — additive and lossless, like everything
  // here.
  const legacy = event as BedEvent & { category?: ProblemCategory | null };
  event.categories ??= legacy.category != null ? [legacy.category] : [];
  event.note ??= '';
  event.reportId ??= null;
}

function normalizeReport(report: Report): void {
  // A report from before the picker went multi-select carried one `category`;
  // it becomes the one-entry list it always meant. Reports filed before the
  // problem picker existed said only how bad it was: "litter" is what the
  // severity sheet was for — it asked how much trash there was — so that is
  // what those rows meant, not a guess.
  const legacy = report as Report & { category?: ProblemCategory };
  report.categories ??= [legacy.category ?? 'litter'];
  report.note ??= '';
  report.severity ??= null;
}

/** The captain's block: W 171st between Fort Washington and Haven. */
export const W171_BLOCK_ID = 'w-171-fort-washington-haven';

/** The pilot demo bed's own block, so it never sits inside a real street. */
export const DEMO_BLOCK_ID = 'w-138-acp-demo';

function checkedInBlocks(): Block[] {
  return [
    {
      id: W171_BLOCK_ID,
      // The captain's own words for the block; typed and editable in admin.
      referenceAddress: '708 W 171st St',
      demo: false,
      createdAt: '2026-09-10T00:00:00.000Z',
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
 * Five guards are ordered — one per willow oak — and none is installed; the
 * white oak has no guard coming (`guardOrderedAt: null`). No tag is bound to
 * any of these beds yet: tags go in with guards (tag-bindings.ts), so
 * `tagUid` is empty and every bed starts unoffered (`offeredSlots: 0`) until
 * the captain opens it on the admin page — which is the page's whole point.
 */
function w171Beds(): Bed[] {
  const GUARDS_ORDERED_AT = '2026-09-09T00:00:00.000Z';
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
      ? { en: 'White oak', es: 'Roble blanco' }
      : { en: 'Willow oak', es: 'Roble sauce' },
    treeId: args.treeId,
    bedName: null,
    tagUid: '',
    crossStreets: 'W 171 St × Fort Washington Ave & Haven Ave',
    address: args.address,
    slots: 1,
    offeredSlots: 0,
    guardOrderedAt: args.whiteOak ? null : GUARDS_ORDERED_AT,
    guardInstalledAt: null,
    blockId: W171_BLOCK_ID,
    blockPosition: args.position,
    nycSyncedAt: LOOKED_UP_AT,
    nycMissingSince: null,
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
 * Make sure the checked-in blocks and the six W 171st beds exist, on the way
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
 */
export function ensureCheckedInBlocks(data: Data): void {
  for (const block of checkedInBlocks()) {
    data.blocks[block.id] ??= block;
  }
  for (const bed of w171Beds()) {
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

// The one hand-seeded bed for the Popl card field test, matching the
// approved screens exactly. No provisioning flow exists yet by design.
//
// `demoPin` is what the backend decides, because it is a deployment question
// rather than a data one: the door screen engraves `@marisol_r` on a public
// screen and sign-in has no rate limiting yet (see the security notes), so a
// well-known PIN on a publicly reachable store hands any passer-by the bed's
// steward — `/mine`, `/photo` and the deliberately auth-gated `/clear`.
// Passing `null` seeds the steward with a hash of a random secret nobody
// holds: the adoption still renders exactly as approved, and no PIN opens it
// until a real one is issued.
export async function seedData(demoPin: string | null = DEMO_STEWARD_PIN): Promise<Data> {
  const marisol: User = {
    id: 'user-marisol',
    firstName: 'Marisol',
    lastName: 'Rivera',
    username: 'marisol_r',
    // Real users get their PIN hashed at signup; nothing plaintext is stored.
    // The async hash keeps the first tap of a cold server off a blocked loop.
    pinHash: await bcrypt.hash(demoPin ?? randomBytes(32).toString('hex'), 10),
    hasSignInRoute: true,
    recordHeldOnBehalf: false,
    email: 'seed-marisol@example.invalid',
    phone: '+1 555 010 0847',
    points: 340,
    streakWeeks: 7,
    createdAt: '2026-05-02T14:00:00.000Z',
  };
  const beds: Record<string, Bed> = {
    'BED-HRL-0847': {
      plate: 'BED-HRL-0847',
      // The number the approved screens carry — a DEMO value from the
      // mockups, matching no real NYC record (checked against `82zj-84is`
      // 2026-09-10: no such objectid). It stays because the live pilot
      // engraves it; hence the null globalid, and the demo flag on the
      // block this bed sits in.
      plantingSpaceId: '15850293',
      plantingSpaceGlobalId: null,
      treeType: { en: 'Willow oak', es: 'Roble sauce' },
      treeId: '08-4211',
      bedName: null,
      tagUid: '04:A2:2F:9C',
      crossStreets: 'W 138 St × Adam Clayton Powell Jr Blvd',
      address: '2300 Adam Clayton Powell Jr Blvd, New York, NY 10030',
      slots: 2,
      offeredSlots: 2,
      guardOrderedAt: null,
      guardInstalledAt: '2026-04-18T16:00:00.000Z',
      blockId: DEMO_BLOCK_ID,
      blockPosition: 1,
      nycSyncedAt: null,
      nycMissingSince: null,
    },
  };
  for (const bed of w171Beds()) beds[bed.plate] = bed;
  return {
    beds,
    blocks: Object.fromEntries(checkedInBlocks().map((block) => [block.id, block])),
    users: { [marisol.id]: marisol },
    adoptions: [
      {
        id: 'adoption-1',
        bedPlate: 'BED-HRL-0847',
        userId: marisol.id,
        adoptedAt: '2026-05-02T14:00:00.000Z',
        stewardKind: 'nfc',
        displayNameHidden: false,
        releasedAt: null,
      },
    ],
    reports: [],
    events: [],
    // Receipt numbers continue from the prototype's RPT-2216-0847.
    reportCounter: 2216,
  };
}

/** Reads hand out detached copies so callers can never mutate stored state in place. */
export function detach<T>(value: T): T {
  return structuredClone(value);
}

// Every operation the Store contract exposes, as plain functions over one
// dataset. The queued store methods and the transaction facade both run these:
// what differs between them is only who owns queueing and persistence.
export const ops = {
  getBed(data: Data, plate: string): Bed | null {
    return detach(data.beds[plate] ?? null);
  },
  createBed(data: Data, bed: Bed): void {
    if (data.beds[bed.plate]) throw new Error(`Bed already exists: ${bed.plate}`);
    data.beds[bed.plate] = detach(bed);
  },
  updateBed(data: Data, bed: Bed): void {
    if (!data.beds[bed.plate]) throw new Error(`Bed not found: ${bed.plate}`);
    data.beds[bed.plate] = detach(bed);
  },
  getBlock(data: Data, id: string): Block | null {
    return detach(data.blocks[id] ?? null);
  },
  getBlocks(data: Data): Block[] {
    // Real streets before demo ones, then by id for a stable order: the
    // captain's own block is what /admin exists for, and letting the ids
    // alphabetise would sit a DEMO-badged fake street above it.
    return detach(
      Object.values(data.blocks).sort(
        (a, b) => Number(a.demo) - Number(b.demo) || a.id.localeCompare(b.id),
      ),
    );
  },
  updateBlock(data: Data, block: Block): void {
    if (!data.blocks[block.id]) throw new Error(`Block not found: ${block.id}`);
    data.blocks[block.id] = detach(block);
  },
  getBedsInBlock(data: Data, blockId: string): Bed[] {
    return detach(
      Object.values(data.beds)
        .filter((bed) => bed.blockId === blockId)
        .sort((a, b) => (a.blockPosition ?? 0) - (b.blockPosition ?? 0)),
    );
  },
  getUser(data: Data, id: string): User | null {
    return detach(data.users[id] ?? null);
  },
  getUserByUsername(data: Data, username: string): User | null {
    const wanted = username.toLowerCase();
    const users = Object.values(data.users);
    return detach(users.find((u) => u.username.toLowerCase() === wanted) ?? null);
  },
  putUser(data: Data, user: User): void {
    data.users[user.id] = detach(user);
  },
  getActiveAdoptions(data: Data, bedPlate: string): Adoption[] {
    return detach(
      data.adoptions
        .filter((a) => a.bedPlate === bedPlate && a.releasedAt === null)
        .sort((a, b) => a.adoptedAt.localeCompare(b.adoptedAt)),
    );
  },
  createAdoption(data: Data, adoption: Adoption): void {
    data.adoptions.push(detach(adoption));
  },
  getOpenReport(data: Data, bedPlate: string): Report | null {
    return detach(data.reports.find((r) => r.bedPlate === bedPlate && r.closedAt === null) ?? null);
  },
  getReport(data: Data, id: string): Report | null {
    return detach(data.reports.find((r) => r.id === id) ?? null);
  },
  getReports(data: Data, bedPlate: string): Report[] {
    return detach(
      data.reports
        .filter((r) => r.bedPlate === bedPlate)
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    );
  },
  createReport(data: Data, report: Report): void {
    data.reports.push(detach(report));
  },
  updateReport(data: Data, report: Report): void {
    const i = data.reports.findIndex((r) => r.id === report.id);
    if (i === -1) throw new Error(`Report not found: ${report.id}`);
    data.reports[i] = detach(report);
  },
  nextReportNumber(data: Data): number {
    data.reportCounter += 1;
    return data.reportCounter;
  },
  appendEvent(data: Data, event: BedEvent): void {
    data.events.push(detach(event));
  },
  getEvents(data: Data, bedPlate: string, eventType?: BedEvent['eventType']): BedEvent[] {
    return detach(
      data.events
        .filter((e) => e.bedPlate === bedPlate && (eventType === undefined || e.eventType === eventType))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
};

/**
 * The Store handed to a transaction callback.
 *
 * It is a distinct object from the store, which is the whole point: work done
 * through it is inside the transaction that created it, work done through the
 * enclosing store is somebody else's request and still has to queue. It writes
 * straight into the dataset the enclosing transaction commits or rolls back —
 * it never persists or re-queues on its own.
 */
export class TransactionStore implements Store {
  constructor(private readonly data: Data) {}

  /** Nested: this callback already holds the chain, so it joins this one. */
  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async getBed(plate: string): Promise<Bed | null> {
    return ops.getBed(this.data, plate);
  }

  async createBed(bed: Bed): Promise<void> {
    ops.createBed(this.data, bed);
  }

  async updateBed(bed: Bed): Promise<void> {
    ops.updateBed(this.data, bed);
  }

  async getBlock(id: string): Promise<Block | null> {
    return ops.getBlock(this.data, id);
  }

  async getBlocks(): Promise<Block[]> {
    return ops.getBlocks(this.data);
  }

  async updateBlock(block: Block): Promise<void> {
    ops.updateBlock(this.data, block);
  }

  async getBedsInBlock(blockId: string): Promise<Bed[]> {
    return ops.getBedsInBlock(this.data, blockId);
  }

  async getUser(id: string): Promise<User | null> {
    return ops.getUser(this.data, id);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return ops.getUserByUsername(this.data, username);
  }

  async createUser(user: User): Promise<void> {
    ops.putUser(this.data, user);
  }

  async updateUser(user: User): Promise<void> {
    ops.putUser(this.data, user);
  }

  async getActiveAdoptions(bedPlate: string): Promise<Adoption[]> {
    return ops.getActiveAdoptions(this.data, bedPlate);
  }

  async createAdoption(adoption: Adoption): Promise<void> {
    ops.createAdoption(this.data, adoption);
  }

  async getOpenReport(bedPlate: string): Promise<Report | null> {
    return ops.getOpenReport(this.data, bedPlate);
  }

  async getReport(id: string): Promise<Report | null> {
    return ops.getReport(this.data, id);
  }

  async getReports(bedPlate: string): Promise<Report[]> {
    return ops.getReports(this.data, bedPlate);
  }

  async createReport(report: Report): Promise<void> {
    ops.createReport(this.data, report);
  }

  async updateReport(report: Report): Promise<void> {
    ops.updateReport(this.data, report);
  }

  async nextReportNumber(): Promise<number> {
    return ops.nextReportNumber(this.data);
  }

  async appendEvent(event: BedEvent): Promise<void> {
    ops.appendEvent(this.data, event);
  }

  async getEvents(bedPlate: string, eventType?: BedEvent['eventType']): Promise<BedEvent[]> {
    return ops.getEvents(this.data, bedPlate, eventType);
  }
}
