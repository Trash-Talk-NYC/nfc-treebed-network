// Netlify Blobs Store implementation: the dataset as a chain of revisions.
//
// The pilot's deployed persistence (wayfinder #8). Netlify functions have no
// disk that survives a request, so the JSON document store-local.ts keeps in
// `.data/` lives in a site-scoped Netlify Blobs store instead — chosen over
// Postgres/Supabase because the free tiers sleep after idle days, which is
// exactly how a randomly-tapped tag behaves. The single-document shape is
// deliberate: the dataset is small at pilot scale, and one document per
// commit is the only way Blobs can commit a multi-entity rule check
// atomically.
//
// Concurrency: function instances scale horizontally, so the in-process
// promise chain that makes LocalStore's transactions exclusive covers only
// one instance. Across instances, `transaction` is optimistic: read the
// newest revision, run the callback on a private copy, and commit by
// *creating* `rev/<n+1>` with `onlyIfNew` — an atomic create-if-absent, so
// exactly one contender owns each revision number. Losing the create means
// another instance committed first, and the whole callback re-runs against
// the dataset that beat it — a rule that checks state before writing it can
// never act on a dataset another commit has replaced. Within one instance,
// transactions still queue on a promise chain: two optimistic local
// transactions would otherwise always collide and burn retries.
//
// Why revisions rather than ETag compare-and-swap on one key: `onlyIfMatch`
// needs an ETag from a read, and reads are exactly where the emulated server
// (`@netlify/blobs/server`, which the tests and `netlify dev` run on) does
// not produce ETags — an implementation the tests cannot exercise is not an
// implementation to bet the pilot's writes on. Conditional creates are
// enforced identically by production and the emulation, and the revision
// chain doubles as a short paper trail when the pilot's data needs a look.
//
// Reads are strongly consistent (`consistency: 'strong'`): after a POST
// redirects, the very next GET can land on a *different* function instance,
// and the receipt it renders must exist there. A read lists the revision
// keys (cheap — cleanup keeps only a handful) and re-downloads the dataset
// only when the newest revision is not the one this instance already holds.

import { getStore as getBlobStore, type Store as BlobsClientStore } from '@netlify/blobs';
import type { Store } from './store';
import type { Adoption, Bed, BedEvent, Report, User } from './types';
import { type Data, TransactionStore, detach, ops, seedData } from './store-dataset';

const STORE_NAME = 'treebed';
const REVISION_PREFIX = 'rev/';

// Optimistic commits only ever lose to real concurrent writers, and at pilot
// scale (one seeded bed) more than a couple of collisions in a row means
// something is wrong — better to surface it than to spin.
const MAX_COMMIT_ATTEMPTS = 5;

// Revisions kept behind the newest one. A reader that listed the newest
// revision and then finds it deleted would need this many commits to land in
// the gap between its list and its get; the buffer makes that a non-event,
// and the survivors are the paper trail mentioned above.
const KEPT_REVISIONS = 8;

interface Loaded {
  data: Data;
  revision: number;
}

export class BlobsStore implements Store {
  private readonly blobs: BlobsClientStore;
  /** Newest revision this instance has seen, revalidated against the key list on every load. */
  private cached: Loaded | null = null;
  /** Serializes this instance's transactions so they don't collide with each other. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * On Netlify the client configures itself from the function environment.
   * Tests inject a client pointed at a local `BlobsServer` instead.
   */
  constructor(blobs?: BlobsClientStore) {
    this.blobs = blobs ?? getBlobStore({ name: STORE_NAME, consistency: 'strong' });
  }

  /** The newest revision number on record, or null before first seed. */
  private async newestRevision(): Promise<number | null> {
    const { blobs } = await this.blobs.list({ prefix: REVISION_PREFIX });
    let newest: number | null = null;
    for (const { key } of blobs) {
      const revision = Number(key.slice(REVISION_PREFIX.length));
      if (Number.isInteger(revision) && (newest === null || revision > newest)) newest = revision;
    }
    return newest;
  }

  /**
   * The current dataset and the revision that identifies it, seeding the
   * store on first contact. The cached copy is only ever a validated one: the
   * key list either confirms it is still the newest or replaces it.
   */
  private async load(): Promise<Loaded> {
    // A newest revision can disappear if it was listed just before falling
    // KEPT_REVISIONS behind — re-list rather than fail the read.
    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
      const newest = await this.newestRevision();
      if (newest === null) {
        const seeded = await this.seed();
        if (seeded) return seeded;
        continue; // Lost the seeding race; the winner's revision is listable now.
      }
      if (this.cached?.revision === newest) return this.cached;
      const data = (await this.blobs.get(revisionKey(newest), { type: 'json' })) as Data | null;
      if (data === null) continue;
      this.cached = { data, revision: newest };
      return this.cached;
    }
    throw new Error(
      `Blob store read lost ${MAX_COMMIT_ATTEMPTS} races with concurrent commits — giving up rather than spinning.`,
    );
  }

  /** First contact: write the seed as revision 1, unless another instance beats us to it. */
  private async seed(): Promise<Loaded | null> {
    const data = await seedData();
    const write = await this.blobs.set(revisionKey(1), serialize(data), { onlyIfNew: true });
    if (!write.modified) return null;
    this.cached = { data, revision: 1 };
    return this.cached;
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    // Queue locally, retry globally: the chain keeps this instance's own
    // transactions from ever conflicting, and the conditional create catches
    // the commits of every other instance.
    const run = this.queue.then(async () => {
      for (let attempt = 1; ; attempt++) {
        const { data, revision } = await this.load();
        // The callback gets its own copy: if it throws, or the commit loses,
        // nothing it wrote can leak into the validated cache.
        const working = detach(data);
        const result = await fn(new TransactionStore(working));
        const write = await this.blobs.set(revisionKey(revision + 1), serialize(working), {
          onlyIfNew: true,
        });
        if (write.modified) {
          this.cached = { data: working, revision: revision + 1 };
          await this.prune(revision + 1);
          return result;
        }
        // Another instance owns the next revision. Drop the stale cache and
        // re-run the callback on the dataset that beat us — its rule checks
        // have to be made against what is actually stored.
        this.cached = null;
        if (attempt >= MAX_COMMIT_ATTEMPTS) {
          throw new Error(
            `Blob store transaction lost ${MAX_COMMIT_ATTEMPTS} optimistic commits in a row — giving up rather than spinning.`,
          );
        }
      }
    });
    // Keep the chain alive even if this transaction throws.
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Best-effort cleanup after a commit: drop revisions more than
   * KEPT_REVISIONS behind the one just written. A failed delete is retried
   * by whoever commits next, so errors are logged rather than surfaced —
   * the commit they trail already succeeded.
   */
  private async prune(committed: number): Promise<void> {
    try {
      const { blobs } = await this.blobs.list({ prefix: REVISION_PREFIX });
      for (const { key } of blobs) {
        const revision = Number(key.slice(REVISION_PREFIX.length));
        if (Number.isInteger(revision) && revision <= committed - KEPT_REVISIONS) {
          await this.blobs.delete(key);
        }
      }
    } catch (err) {
      console.error('[store-blobs] pruning old revisions failed (will retry on a later commit):', err);
    }
  }

  // Reads run on the newest validated dataset; standalone mutations are
  // one-call transactions, so they get the same queue and conflict retry.
  async getBed(plate: string): Promise<Bed | null> {
    return ops.getBed((await this.load()).data, plate);
  }

  async getUser(id: string): Promise<User | null> {
    return ops.getUser((await this.load()).data, id);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return ops.getUserByUsername((await this.load()).data, username);
  }

  async createUser(user: User): Promise<void> {
    await this.transaction((tx) => tx.createUser(user));
  }

  async updateUser(user: User): Promise<void> {
    await this.transaction((tx) => tx.updateUser(user));
  }

  async getActiveAdoptions(bedPlate: string): Promise<Adoption[]> {
    return ops.getActiveAdoptions((await this.load()).data, bedPlate);
  }

  async createAdoption(adoption: Adoption): Promise<void> {
    await this.transaction((tx) => tx.createAdoption(adoption));
  }

  async getOpenReport(bedPlate: string): Promise<Report | null> {
    return ops.getOpenReport((await this.load()).data, bedPlate);
  }

  async getReport(id: string): Promise<Report | null> {
    return ops.getReport((await this.load()).data, id);
  }

  async getReports(bedPlate: string): Promise<Report[]> {
    return ops.getReports((await this.load()).data, bedPlate);
  }

  async createReport(report: Report): Promise<void> {
    await this.transaction((tx) => tx.createReport(report));
  }

  async updateReport(report: Report): Promise<void> {
    await this.transaction((tx) => tx.updateReport(report));
  }

  async nextReportNumber(): Promise<number> {
    return this.transaction((tx) => tx.nextReportNumber());
  }

  async appendEvent(event: BedEvent): Promise<void> {
    await this.transaction((tx) => tx.appendEvent(event));
  }

  async getEvents(bedPlate: string, eventType?: BedEvent['eventType']): Promise<BedEvent[]> {
    return ops.getEvents((await this.load()).data, bedPlate, eventType);
  }
}

function revisionKey(revision: number): string {
  return `${REVISION_PREFIX}${revision}`;
}

// Pretty-printed for parity with store-local.ts: `netlify blobs:get` hands a
// human something they can read when the pilot needs a look at its data.
function serialize(data: Data): string {
  return JSON.stringify(data, null, 2);
}
