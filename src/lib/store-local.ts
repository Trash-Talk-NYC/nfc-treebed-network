// Local Store implementation: one JSON file on disk (.data/store.json).
//
// This is the ONLY file that knows how data is persisted. Swapping to a real
// database later means writing another implementation of `Store` and changing
// `getStore()` below — no other file in the app changes.
//
// Concurrency note: mutations are serialized through a single promise chain
// and written with write-to-temp + rename, which is enough for a single-node
// MVP. A real database replaces this wholesale.

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

const DATA_DIR = process.env.TREEBED_DATA_DIR ?? path.resolve('.data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

// The one hand-seeded bed for the Popl card field test, matching the
// approved prototype exactly. No provisioning flow exists yet by design.
function seedData(): Data {
  const marisol: User = {
    id: 'user-marisol',
    name: 'Marisol R.',
    username: 'marisol_r',
    // Demo adopter for driving the sign-in flow locally: PIN 1234.
    // Real users get their PIN hashed at signup; nothing plaintext is stored.
    pinHash: bcrypt.hashSync('1234', 10),
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

export class LocalStore implements Store {
  private data: Data | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string = DATA_FILE) {}

  private async load(): Promise<Data> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8')) as Data;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.data = seedData();
      await this.persist();
    }
    return this.data;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  /** Serialize mutations so concurrent requests can't interleave read-modify-write. */
  private mutate<T>(fn: (data: Data) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.load();
      const result = fn(data);
      await this.persist();
      return result;
    });
    // Keep the chain alive even if this mutation throws.
    this.queue = run.catch(() => undefined);
    return run;
  }

  async getBed(plate: string): Promise<Bed | null> {
    return (await this.load()).beds[plate] ?? null;
  }

  async getUser(id: string): Promise<User | null> {
    return (await this.load()).users[id] ?? null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const wanted = username.toLowerCase();
    const users = Object.values((await this.load()).users);
    return users.find((u) => u.username.toLowerCase() === wanted) ?? null;
  }

  async createUser(user: User): Promise<void> {
    await this.mutate((data) => {
      data.users[user.id] = user;
    });
  }

  async updateUser(user: User): Promise<void> {
    await this.mutate((data) => {
      data.users[user.id] = user;
    });
  }

  async getActiveAdoptions(bedPlate: string): Promise<Adoption[]> {
    const data = await this.load();
    return data.adoptions
      .filter((a) => a.bedPlate === bedPlate && a.releasedAt === null)
      .sort((a, b) => a.adoptedAt.localeCompare(b.adoptedAt));
  }

  async createAdoption(adoption: Adoption): Promise<void> {
    await this.mutate((data) => {
      data.adoptions.push(adoption);
    });
  }

  async getOpenReport(bedPlate: string): Promise<Report | null> {
    const data = await this.load();
    return data.reports.find((r) => r.bedPlate === bedPlate && r.closedAt === null) ?? null;
  }

  async getReport(id: string): Promise<Report | null> {
    return (await this.load()).reports.find((r) => r.id === id) ?? null;
  }

  async getReports(bedPlate: string): Promise<Report[]> {
    const data = await this.load();
    return data.reports
      .filter((r) => r.bedPlate === bedPlate)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  async createReport(report: Report): Promise<void> {
    await this.mutate((data) => {
      data.reports.push(report);
    });
  }

  async updateReport(report: Report): Promise<void> {
    await this.mutate((data) => {
      const i = data.reports.findIndex((r) => r.id === report.id);
      if (i === -1) throw new Error(`Report not found: ${report.id}`);
      data.reports[i] = report;
    });
  }

  async nextReportNumber(): Promise<number> {
    return this.mutate((data) => {
      data.reportCounter += 1;
      return data.reportCounter;
    });
  }

  async appendEvent(event: BedEvent): Promise<void> {
    await this.mutate((data) => {
      data.events.push(event);
    });
  }

  async getEvents(bedPlate: string, eventType?: BedEvent['eventType']): Promise<BedEvent[]> {
    const data = await this.load();
    return data.events
      .filter((e) => e.bedPlate === bedPlate && (eventType === undefined || e.eventType === eventType))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

let instance: Store | null = null;

/** The app-wide store. Swap the implementation here when a real DB lands. */
export function getStore(): Store {
  instance ??= new LocalStore();
  return instance;
}
