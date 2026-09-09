// The dataset every Store implementation persists, and the pure operations
// over it. This file knows nothing about *where* data lives — store-local.ts
// (a JSON file on disk) and store-blobs.ts (Netlify Blobs) each own their
// persistence and share this shape, the seed, and the operations, so the two
// backends cannot drift apart on what the data means.

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Store } from './store';
import type { Adoption, Bed, BedEvent, Report, User } from './types';

export interface Data {
  beds: Record<string, Bed>;
  users: Record<string, User>;
  adoptions: Adoption[];
  reports: Report[];
  events: BedEvent[];
  reportCounter: number;
}

/** The demo PIN the seeded steward gets where sign-in is not publicly reachable. */
export const DEMO_ADOPTER_PIN = '1234';

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
  for (const bed of Object.values(data.beds)) normalizeBed(bed);
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
  if (typeof legacy.treeType !== 'object' || legacy.treeType === null) {
    bed.treeType = { en: 'tree', es: 'árbol' };
  }
  bed.nycSyncedAt ??= null;
  bed.nycMissingSince ??= null;
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
  // on the way past rather than rewriting the row.
  event.category ??= null;
  event.note ??= '';
  event.reportId ??= null;
}

function normalizeReport(report: Report): void {
  // Reports filed before the problem picker said only how bad it was. "Litter"
  // is what the severity sheet was for — it asked how much trash there was —
  // so that is what those rows meant, not a guess.
  report.category ??= 'litter';
  report.note ??= '';
  report.severity ??= null;
}

// The one hand-seeded bed for the Popl card field test, matching the
// approved prototype exactly. No provisioning flow exists yet by design.
//
// `demoPin` is what the backend decides, because it is a deployment question
// rather than a data one: the plaque engraves `@marisol_r` on a public screen
// and sign-in has no rate limiting yet (see the security notes), so a
// well-known PIN on a publicly reachable store hands any passer-by the bed's
// guardian — `/mine`, `/photo` and the deliberately auth-gated `/clear`.
// Passing `null` seeds the adopter with a hash of a random secret nobody
// holds: the adoption still renders exactly as approved, and no PIN opens it
// until a real one is issued.
export async function seedData(demoPin: string | null = DEMO_ADOPTER_PIN): Promise<Data> {
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
  return {
    beds: {
      'BED-HRL-0847': {
        plate: 'BED-HRL-0847',
        // The number the approved screens carry. Public identity is NYC's,
        // ours is the join key underneath it.
        plantingSpaceId: '15850293',
        treeType: { en: 'Willow oak', es: 'Roble sauce' },
        treeId: '08-4211',
        tagUid: '04:A2:2F:9C',
        crossStreets: 'W 138 St × Adam Clayton Powell Jr Blvd',
        address: '2300 Adam Clayton Powell Jr Blvd, New York, NY 10030',
        slots: 2,
        guardInstalledAt: '2026-04-18T16:00:00.000Z',
        nycSyncedAt: null,
        nycMissingSince: null,
      },
    },
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
