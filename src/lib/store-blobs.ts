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
// and the receipt it renders must exist there. That guarantee covers `get`
// and not `list` — key listings are eventually consistent whatever the store
// is configured with — so which revision is newest is never decided by a
// listing alone. A read takes the `head` pointer (a strongly consistent get)
// as a lower bound, then walks forward one strongly consistent get at a time
// until a revision is missing: the pointer can lag, the walk cannot, because
// a revision that exists is a revision `get` is required to return. The
// listing survives only as the fallback for a pointer that is missing or
// points at a pruned revision, where being approximately right is enough to
// start the walk from. What the listing is never allowed to decide is that
// the store is *empty*: a stale-empty listing on a store whose rev/1 has long
// since been pruned would seed a fresh chain over live data. A head that has
// been read even once says the store has been written to, and seeding is
// refused from there on.
//
// The dataset is re-downloaded only when that walk ends somewhere this
// instance is not already holding, and the whole revalidation happens at most
// once per request: request-context.ts memoizes it, so a screen making four
// reads makes one round trip's worth of them and sees one revision across all
// four rather than possibly two.

import { getStore as getBlobStore, type Store as BlobsClientStore } from '@netlify/blobs';
import type { Store } from './store';
import { BUILD_TARGET } from './build-target';
import { getRequestContext } from './request-context';
import type { Adoption, Bed, BedEvent, Report, User } from './types';
import { type Data, TransactionStore, detach, normalizeData, ops, seedData } from './store-dataset';

const STORE_NAME = 'treebed';
const REVISION_PREFIX = 'rev/';

// Points at a recently committed revision. A hint, not a source of truth:
// two instances committing at once can land their pointer writes in either
// order, so it is only ever a place to start walking forward from.
const HEAD_KEY = 'head';

// Optimistic commits only ever lose to real concurrent writers, and at pilot
// scale (one seeded bed) more than a couple of collisions in a row means
// something is wrong — better to surface it than to spin.
const MAX_COMMIT_ATTEMPTS = 5;

// Revisions retained, the newest one included: `prune` deletes
// `committed - KEPT_REVISIONS`, so rev/n-7 .. rev/n survive. A reader that
// listed the newest revision and then finds it deleted would need the seven
// commits behind it to land in the gap between its list and its get; the
// buffer makes that a non-event, and the survivors are the paper trail
// mentioned above.
const KEPT_REVISIONS = 8;

interface Loaded {
  data: Data;
  revision: number;
}

export class BlobsStore implements Store {
  private readonly blobs: BlobsClientStore;
  /** Newest revision this instance has seen, revalidated on every load. */
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
   * store on first contact.
   *
   * Memoized for the request being served: within one request the dataset is
   * validated once, so a render's four reads cost one revalidation and agree
   * with each other. Outside a request (a script, the unit suites) every read
   * revalidates.
   */
  private load(): Promise<Loaded> {
    const context = getRequestContext();
    if (context === undefined) return this.revalidate();
    const memo = context.storeReads.get(this) as Promise<Loaded> | undefined;
    if (memo !== undefined) return memo;
    const loaded = this.revalidate();
    context.storeReads.set(this, loaded);
    // A failed read must not be the answer every later read in this request
    // gets — the next one is allowed to try the network again.
    loaded.catch(() => {
      if (context.storeReads.get(this) === loaded) context.storeReads.delete(this);
    });
    return loaded;
  }

  /**
   * The newest dataset there is, from the network: the pointer (or, failing
   * that, the key listing) says where to start, and forward gets say where to
   * stop. The cached copy is only ever a validated one — the walk either
   * confirms it is still the newest or replaces it.
   */
  private async revalidate(): Promise<Loaded> {
    // A head that has been seen once is proof the store has been written to,
    // and that proof outlives an attempt: seeding is only ever correct where
    // nothing has ever committed.
    let headSeen: number | null = null;
    // The pointer stops being a starting point once it names a revision that
    // is gone — pruned, or never there — and the listing takes over.
    let trustHead = true;
    // A revision this read has proved exists, whatever the pointer and the
    // listing say. Losing the seeding race is exactly such a proof: the
    // conditional create only refuses because rev/1 is already there.
    let known = 0;
    // A revision can disappear from under a read if it was named just before
    // falling out of the KEPT_REVISIONS window — re-derive rather than fail the read.
    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
      const head = trustHead ? await this.readHead() : null;
      if (head !== null) headSeen = head;
      let from = Math.max(this.cached?.revision ?? 0, head ?? 0, known);
      if (from === 0) from = (await this.newestRevision()) ?? 0;
      if (from === 0) {
        // The listing is eventually consistent, so an empty one is never
        // proof the store is new. Seeding on a stale-empty listing would
        // write rev/1 back over a live chain whose rev/1 was pruned long ago,
        // fork every later read onto it, and lose the pilot's data silently.
        if (headSeen !== null) {
          throw new Error(
            `Blob store head names rev/${headSeen} but no revision could be read — refusing to seed over a store that already holds data.`,
          );
        }
        const seeded = await this.seed();
        if (seeded) return seeded;
        // Lost the seeding race. The refused create is itself strongly
        // consistent proof that rev/1 exists, so walk from there rather than
        // asking the listing again — which, still stale-empty, would send us
        // back through another bcrypt-priced seed to lose again.
        known = 1;
        continue;
      }
      const found = await this.walkForward(from);
      if (found !== null) {
        this.cached = found;
        return found;
      }
      // Where we started no longer exists: drop it and ask the listing.
      this.cached = null;
      trustHead = false;
    }
    throw new Error(
      `Blob store read lost ${MAX_COMMIT_ATTEMPTS} races with concurrent commits — giving up rather than spinning.`,
    );
  }

  /**
   * The dataset at `from`, then each revision after it, stopping at the first
   * one that is missing. Every get is strongly consistent, so the first miss
   * is the end of the chain and not a replication lag. Null if `from` itself
   * is gone, which means the caller's starting point was stale.
   */
  private async walkForward(from: number): Promise<Loaded | null> {
    let revision = from;
    let data = this.cached?.revision === from ? this.cached.data : await this.readRevision(from);
    if (data === null) return null;
    for (;;) {
      const next = await this.readRevision(revision + 1);
      if (next === null) return { data, revision };
      revision += 1;
      data = next;
    }
  }

  private async readRevision(revision: number): Promise<Data | null> {
    const data = (await this.blobs.get(revisionKey(revision), { type: 'json' })) as Data | null;
    // The pilot store holds revisions written before the tap flow's fields
    // existed, and re-seeding over live data is refused by design. The shape is
    // reconciled here instead — additively, on the way in, for both backends
    // (store-dataset.ts).
    return data === null ? null : normalizeData(data);
  }

  /** The pointer's revision, or null when there is none to trust. */
  private async readHead(): Promise<number | null> {
    const raw = await this.blobs.get(HEAD_KEY, { type: 'text' });
    if (raw === null) return null;
    const revision = Number(raw);
    return Number.isInteger(revision) && revision > 0 ? revision : null;
  }

  /**
   * Move the pointer to the revision just committed. Best-effort on purpose:
   * a pointer that lags, or that a racing commit moves back a revision, only
   * lengthens the forward walk, and the next commit corrects it.
   */
  private async setHead(revision: number): Promise<void> {
    try {
      await this.blobs.set(HEAD_KEY, String(revision));
    } catch (err) {
      console.error('[store-blobs] moving the head pointer failed (reads walk forward anyway):', err);
    }
  }

  /**
   * First contact: write the seed as revision 1, unless another instance beats
   * us to it.
   *
   * The seeded adopter gets no demo PIN here. This store is the deployed,
   * publicly tappable one, its plaque engraves `@marisol_r`, and sign-in has
   * no rate limiting yet — a PIN everybody knows would be an open guardian
   * account on the internet. TREEBED_SEED_PIN is a development-only seam for
   * driving the sign-in flow against this backend locally, and the netlify
   * target ignores it outright: a production build that cannot honour the
   * variable cannot be talked into an open guardian account by a stray
   * `netlify env:set`. Unset — and on netlify, always — no PIN opens it.
   */
  private async seed(): Promise<Loaded | null> {
    const seedPin = BUILD_TARGET === 'netlify' ? null : process.env.TREEBED_SEED_PIN || null;
    const data = await seedData(seedPin);
    const write = await this.blobs.set(revisionKey(1), serialize(data), { onlyIfNew: true });
    if (!write.modified) return null;
    await this.setHead(1);
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
          const committed = { data: working, revision: revision + 1 };
          this.cached = committed;
          // The rest of this request reads its own write, not the dataset the
          // memo validated before it.
          this.memoize(committed);
          await this.setHead(committed.revision);
          await this.prune(committed.revision);
          return result;
        }
        // Another instance owns the next revision. Drop the stale cache — and
        // this request's memo of it, or every attempt would re-run against the
        // same stale dataset — and re-run the callback on the dataset that beat
        // us: its rule checks have to be made against what is actually stored.
        this.cached = null;
        this.forgetMemo();
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

  /** Publish a known-current dataset as this request's memoized read. */
  private memoize(loaded: Loaded): void {
    getRequestContext()?.storeReads.set(this, Promise.resolve(loaded));
  }

  /** Drop this request's memoized read; the next one revalidates. */
  private forgetMemo(): void {
    getRequestContext()?.storeReads.delete(this);
  }

  /**
   * Best-effort cleanup after a commit: drop the one revision that this
   * commit pushed out of the KEPT_REVISIONS window. Every commit is on the
   * critical path of somebody standing at a tree, so the steady state costs a
   * single delete — a listing would be a whole extra round trip to rediscover a
   * revision number arithmetic already knows.
   *
   * The listing is what collects what the arithmetic cannot: a delete that
   * threw, and a delete that never ran at all because the instance was
   * recycled between the commit and this call — later commits each drop only
   * their own expired revision, so an orphan below the window would otherwise
   * be a full copy of the dataset nothing ever reclaims. So it sweeps on a
   * failure and once every KEPT_REVISIONS commits, which keeps the extra
   * round trip off all but one commit in eight. Errors are logged rather than
   * surfaced, since the commit they trail already succeeded.
   */
  private async prune(committed: number): Promise<void> {
    const expired = committed - KEPT_REVISIONS;
    if (expired < 1) return;
    if (committed % KEPT_REVISIONS === 0) {
      await this.sweep(expired);
      return;
    }
    try {
      await this.blobs.delete(revisionKey(expired));
    } catch (err) {
      console.error('[store-blobs] pruning rev/%d failed; sweeping instead:', expired, err);
      await this.sweep(expired);
    }
  }

  /** Delete every revision at or below `expired`, including earlier leftovers. */
  private async sweep(expired: number): Promise<void> {
    try {
      const { blobs } = await this.blobs.list({ prefix: REVISION_PREFIX });
      for (const { key } of blobs) {
        const revision = Number(key.slice(REVISION_PREFIX.length));
        if (Number.isInteger(revision) && revision <= expired) {
          await this.blobs.delete(key);
        }
      }
    } catch (err) {
      console.error('[store-blobs] sweeping old revisions failed (will retry on a later commit):', err);
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

// Compact, unlike store-local.ts: every commit uploads the whole dataset and
// every tap is a commit, so indentation is bytes paid on the critical path and
// again on each of the KEPT_REVISIONS copies the window retains. `netlify blobs:get
// treebed rev/<n> | jq` covers the readability it costs.
function serialize(data: Data): string {
  return JSON.stringify(data);
}
