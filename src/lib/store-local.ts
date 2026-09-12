// Local Store implementation: one JSON file on disk (.data/store.json).
//
// The dataset shape, the seed, and the operations over it live in
// store-dataset.ts, shared with store-blobs.ts; this file owns how the local
// backend persists that dataset, and nothing else — the `getStore()` factory
// that picks a backend lives in store.ts, beside the contract both implement.
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
import type { Store } from './store';
import type {
  Adoption,
  Bed,
  BedEvent,
  Block,
  NetworkSettings,
  Report,
  SignInMissWindow,
  SignInRequest,
  SignInToken,
  User,
} from './types';
import { type Data, TransactionStore, detach, normalizeData, ops, seedData } from './store-dataset';

// `.data/` beside the repo, unless TREEBED_DATA_DIR moves it — session.ts keeps
// the dev session secret in the same directory. The end-to-end suite sets it so
// every server it spawns starts on a store of its own, rather than on whatever
// the developer's own runs have left behind.
const DATA_DIR = process.env.TREEBED_DATA_DIR ?? path.resolve('.data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

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
      // Normalized on the way in: a store file written before the tap
      // flow's fields existed is reconciled additively, never migrated.
      data = normalizeData(JSON.parse(await fs.readFile(this.file, 'utf8')) as Data);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      data = seedData();
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

  async createBed(bed: Bed): Promise<void> {
    await this.mutate((data) => ops.createBed(data, bed));
  }

  async updateBed(bed: Bed): Promise<void> {
    await this.mutate((data) => ops.updateBed(data, bed));
  }

  async getBlock(id: string): Promise<Block | null> {
    return ops.getBlock(await this.load(), id);
  }

  async getBlocks(): Promise<Block[]> {
    return ops.getBlocks(await this.load());
  }

  async updateBlock(block: Block): Promise<void> {
    await this.mutate((data) => ops.updateBlock(data, block));
  }

  async getBedsInBlock(blockId: string): Promise<Bed[]> {
    return ops.getBedsInBlock(await this.load(), blockId);
  }

  async getUser(id: string): Promise<User | null> {
    return ops.getUser(await this.load(), id);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return ops.getUserByUsername(await this.load(), username);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return ops.getUserByEmail(await this.load(), email);
  }

  async getUsers(): Promise<User[]> {
    return ops.getUsers(await this.load());
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

  async getActiveAdoptionsForUser(userId: string): Promise<Adoption[]> {
    return ops.getActiveAdoptionsForUser(await this.load(), userId);
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

  async getSignInToken(tokenHash: string): Promise<SignInToken | null> {
    return ops.getSignInToken(await this.load(), tokenHash);
  }

  async createSignInToken(token: SignInToken): Promise<void> {
    await this.mutate((data) => ops.createSignInToken(data, token));
  }

  async deleteSignInToken(tokenHash: string): Promise<void> {
    await this.mutate((data) => ops.deleteSignInToken(data, tokenHash));
  }

  async deleteSignInTokensExpiredBy(now: string): Promise<void> {
    await this.mutate((data) => ops.deleteSignInTokensExpiredBy(data, now));
  }

  async getSignInRequestsSince(since: string): Promise<SignInRequest[]> {
    return ops.getSignInRequestsSince(await this.load(), since);
  }

  async appendSignInRequest(request: SignInRequest): Promise<void> {
    await this.mutate((data) => ops.appendSignInRequest(data, request));
  }

  async deleteSignInRequestsBefore(cutoff: string): Promise<void> {
    await this.mutate((data) => ops.deleteSignInRequestsBefore(data, cutoff));
  }

  async getSignInMissWindow(bedPlate: string): Promise<SignInMissWindow | null> {
    return ops.getSignInMissWindow(await this.load(), bedPlate);
  }

  async putSignInMissWindow(window: SignInMissWindow): Promise<void> {
    await this.mutate((data) => ops.putSignInMissWindow(data, window));
  }

  async getNetworkSettings(): Promise<NetworkSettings> {
    return ops.getNetworkSettings(await this.load());
  }

  async updateNetworkSettings(settings: NetworkSettings): Promise<void> {
    await this.mutate((data) => ops.updateNetworkSettings(data, settings));
  }
}
