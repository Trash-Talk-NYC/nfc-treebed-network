// Local Store implementation: one JSON file on disk (.data/store.json).
//
// This is the ONLY file that knows how data is persisted. Swapping to a real
// database later means writing another implementation of `Store` and changing
// `getStore()` below — no other file in the app changes.
//
// Concurrency note: mutations are serialized through a single promise chain
// and written with write-to-temp + rename, which is enough for a single-node
// MVP. A real database replaces this wholesale.
//
// `transaction` extends that chain to whole read-check-write sequences: the
// callback holds the chain for its duration, so a rule that checks state
// before writing it cannot be raced. The callback gets its own `Store` — a
// `TransactionStore` bound to the dataset the transaction will commit — and
// that object's identity is what marks work as belonging inside the
// transaction. Every call made through the LocalStore itself queues, whenever
// it arrives, including while a transaction is awaiting its disk write.
// In-memory state is snapshotted on entry and restored if the callback or the
// disk write fails, so a failure never leaves memory ahead of disk.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { Store } from './store';
import type { Adoption, Bed, BedEvent, Report, User } from './types';

interface Data {
  beds: Record<string, Bed>;
  users: Record<string, User>;
  adoptions: Adoption[];
  reports: Report[];
  events: BedEvent[];
  reportCounter: number;
}

// `.data/` beside the repo, unless TREEBED_DATA_DIR moves it — session.ts keeps
// the dev session secret in the same directory. The end-to-end suite sets it so
// every server it spawns starts on a store of its own, rather than on whatever
// the developer's own runs have left behind.
const DATA_DIR = process.env.TREEBED_DATA_DIR ?? path.resolve('.data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

// The one hand-seeded bed for the Popl card field test, matching the
// approved prototype exactly. No provisioning flow exists yet by design.
async function seedData(): Promise<Data> {
  const marisol: User = {
    id: 'user-marisol',
    name: 'Marisol R.',
    username: 'marisol_r',
    // Demo adopter for driving the sign-in flow locally: PIN 1234.
    // Real users get their PIN hashed at signup; nothing plaintext is stored.
    // The async hash keeps the first tap of a cold server off a blocked loop.
    pinHash: await bcrypt.hash('1234', 10),
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
        treeId: '08-4211',
        tagUid: '04:A2:2F:9C',
        crossStreets: 'W 138 St × Adam Clayton Powell Jr Blvd',
        address: '2300 Adam Clayton Powell Jr Blvd, New York, NY 10030',
        slots: 2,
        guardInstalledAt: '2026-04-18T16:00:00.000Z',
      },
    },
    users: { [marisol.id]: marisol },
    adoptions: [
      {
        id: 'adoption-1',
        bedPlate: 'BED-HRL-0847',
        userId: marisol.id,
        adoptedAt: '2026-05-02T14:00:00.000Z',
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
function detach<T>(value: T): T {
  return structuredClone(value);
}

// Every operation the Store contract exposes, as plain functions over one
// dataset. The queued store methods and the transaction facade both run these:
// what differs between them is only who owns queueing and persistence.
const ops = {
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
 * LocalStore is somebody else's request and still has to queue. It writes
 * straight into the dataset the enclosing transaction commits or rolls back —
 * it never persists or re-queues on its own.
 */
class TransactionStore implements Store {
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

export class LocalStore implements Store {
  private data: Data | null = null;
  /** In-flight first read, shared by every caller that arrives before it lands. */
  private loading: Promise<Data> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string = DATA_FILE) {}

  private load(): Promise<Data> {
    if (this.data) return Promise.resolve(this.data);
    // Concurrent first requests have to share one read: two of them seeding
    // in parallel both write the same temp file, and the loser sees ENOENT
    // when its rename finds the file already moved.
    this.loading ??= this.readOrSeed().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async readOrSeed(): Promise<Data> {
    let data: Data;
    try {
      data = JSON.parse(await fs.readFile(this.file, 'utf8')) as Data;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      data = await seedData();
      // Published only once it is on disk: while `this.data` is still null,
      // everyone else waits on this read. Publishing first lets the next
      // request's write persist alongside the seed, and the two renames of
      // the same temp file leave the loser with ENOENT and its write lost.
      await this.persist(data);
    }
    this.data = data;
    return data;
  }

  private async persist(data: Data): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    // The callback works through its own Store for the whole sequence; calls
    // that arrive on this store meanwhile belong to another request and wait.
    return this.enqueue(async (data) => fn(new TransactionStore(data)));
  }

  /** Serialize mutations so concurrent requests can't interleave read-modify-write. */
  private mutate<T>(fn: (data: Data) => T): Promise<T> {
    return this.enqueue(async (data) => fn(data));
  }

  /** Run `fn` alone on the chain, committing on success and rolling back on failure. */
  private enqueue<T>(fn: (data: Data) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.load();
      const snapshot = detach(data);
      try {
        const result = await fn(data);
        await this.persist(data);
        return result;
      } catch (err) {
        // Half-applied writes must not outlive the failure — including a
        // failed persist(), which would otherwise leave memory ahead of disk.
        // Restored into the same object rather than swapped for the snapshot:
        // a read that already holds this reference must see the rollback too.
        Object.assign(data, snapshot);
        throw err;
      }
    });
    // Keep the chain alive even if this mutation throws.
    this.queue = run.catch(() => undefined);
    return run;
  }

  async getBed(plate: string): Promise<Bed | null> {
    return ops.getBed(await this.load(), plate);
  }

  async getUser(id: string): Promise<User | null> {
    return ops.getUser(await this.load(), id);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return ops.getUserByUsername(await this.load(), username);
  }

  async createUser(user: User): Promise<void> {
    await this.mutate((data) => ops.putUser(data, user));
  }

  async updateUser(user: User): Promise<void> {
    await this.mutate((data) => ops.putUser(data, user));
  }

  async getActiveAdoptions(bedPlate: string): Promise<Adoption[]> {
    return ops.getActiveAdoptions(await this.load(), bedPlate);
  }

  async createAdoption(adoption: Adoption): Promise<void> {
    await this.mutate((data) => ops.createAdoption(data, adoption));
  }

  async getOpenReport(bedPlate: string): Promise<Report | null> {
    return ops.getOpenReport(await this.load(), bedPlate);
  }

  async getReport(id: string): Promise<Report | null> {
    return ops.getReport(await this.load(), id);
  }

  async getReports(bedPlate: string): Promise<Report[]> {
    return ops.getReports(await this.load(), bedPlate);
  }

  async createReport(report: Report): Promise<void> {
    await this.mutate((data) => ops.createReport(data, report));
  }

  async updateReport(report: Report): Promise<void> {
    await this.mutate((data) => ops.updateReport(data, report));
  }

  async nextReportNumber(): Promise<number> {
    return this.mutate((data) => ops.nextReportNumber(data));
  }

  async appendEvent(event: BedEvent): Promise<void> {
    await this.mutate((data) => ops.appendEvent(data, event));
  }

  async getEvents(bedPlate: string, eventType?: BedEvent['eventType']): Promise<BedEvent[]> {
    return ops.getEvents(await this.load(), bedPlate, eventType);
  }
}

let instance: Store | null = null;

/** The app-wide store. Swap the implementation here when a real DB lands. */
export function getStore(): Store {
  instance ??= new LocalStore();
  return instance;
}
