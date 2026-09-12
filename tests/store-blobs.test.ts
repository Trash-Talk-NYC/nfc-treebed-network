// BlobsStore, proven against a real Netlify Blobs server.
//
// @netlify/blobs ships `BlobsServer` — the same HTTP surface production
// speaks, backed by a local directory — so these tests exercise the actual
// wire path: strongly consistent GETs, `onlyIfNew` seeding, and the
// create-if-absent commits the optimistic transaction depends on. Nothing
// here is mocked.
//
// Two BlobsStore instances sharing one server stand in for two Netlify
// function instances sharing one site store: the in-process queue that
// protects LocalStore does not exist across instances, and these tests are
// where the cross-instance story — read-your-writes, conflict retry, rule
// enforcement — is actually held to.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getStore as getBlobClientStore, type Store as BlobsClientStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { BlobsStore } from '../src/lib/store-blobs';
import { rewriteStoredSpeciesCasing } from '../scripts/species-casing-rewrite.mjs';
import { runInRequestContext } from '../src/lib/request-context';
import { consumeSignInToken, reportProblem, requestSignInLink } from '../src/lib/service';
import type { BedEvent } from '../src/lib/types';

const PLATE = 'BED-HRL-0847';
const TOKEN = 'treebed-test-token';
const SITE_ID = 'treebed-test-site';

let server: BlobsServer;
let directory = '';
let edgeURL = '';

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'treebed-blobs-'));
  server = new BlobsServer({ directory, port: 0, token: TOKEN });
  const { port } = await server.start();
  edgeURL = `http://localhost:${port}`;
});

afterAll(async () => {
  await server.stop();
  rmSync(directory, { recursive: true, force: true });
});

// Each test gets a store name of its own: same server, fresh dataset, the
// way one Netlify site's store starts empty.
let storeCount = 0;
let storeName = '';
beforeEach(() => {
  storeCount += 1;
  storeName = `treebed-test-${storeCount}`;
});

function client(): BlobsClientStore {
  return getBlobClientStore({
    name: storeName,
    siteID: SITE_ID,
    token: TOKEN,
    edgeURL,
    // Strong consistency reads go to the uncached endpoint; the local test
    // server is both, so both point at it.
    uncachedEdgeURL: edgeURL,
    consistency: 'strong',
  });
}

/** A separate BlobsStore over the same underlying blob — a second function instance. */
function instance(): BlobsStore {
  return new BlobsStore(client());
}

async function revisionKeys(): Promise<string[]> {
  const { blobs } = await client().list({ prefix: 'rev/' });
  return blobs.map(({ key }) => key);
}

function tapEvent(id: string): BedEvent {
  return {
    id,
    bedPlate: PLATE,
    eventType: 'tap',
    severity: null,
    categories: [],
    note: '',
    reportId: null,
    actorId: 'visitor-1',
    createdAt: new Date().toISOString(),
  };
}

describe('seeding', () => {
  it('seeds the pilot bed on first contact', async () => {
    const store = instance();
    const bed = await store.getBed(PLATE);
    expect(bed?.plate).toBe(PLATE);
    expect(bed?.crossStreets).toBe('W 138 St × Adam Clayton Powell Jr Blvd');
    const adoptions = await store.getActiveAdoptions(PLATE);
    expect(adoptions).toHaveLength(1);
    const marisol = await store.getUserByUsername('marisol_r');
    expect(marisol?.firstName).toBe('Marisol');
    expect(marisol?.lastName).toBe('Rivera');
  });

  it('seeds no account any secret can open, and the sign-in rules still work over the wire', async () => {
    const store = instance();
    // This backend is the publicly tappable one and the plaque engraves the
    // steward's handle, so the seed must hold nothing a passer-by can use:
    // sign-in is the emailed link, the seed email is a reserved `.invalid`
    // address, and the token path — mint, verify, burn — runs against the
    // real wire protocol here.
    const outcome = await requestSignInLink(store, {
      plate: PLATE,
      email: 'seed-marisol@example.invalid',
    });
    expect(outcome.kind).toBe('sent');
    if (outcome.kind !== 'sent') throw new Error('unreachable');
    const user = await consumeSignInToken(store, { plate: PLATE, token: outcome.token });
    expect(user.username).toBe('marisol_r');
    // Single use survives the round trip too.
    await expect(
      consumeSignInToken(store, { plate: PLATE, token: outcome.token }),
    ).rejects.toMatchObject({ code: 'invalid-token' });
  });

  it('refuses to seed over a store whose head says it has been written to', async () => {
    const a = instance();
    await a.appendEvent(tapEvent('evt-live-data'));
    // The state a stale listing produces on a long-lived store: rev/1 pruned
    // long ago, the listing not yet showing what replaced it. Seeding here
    // would fork a fresh chain over the pilot's data, so the head — which a
    // strongly consistent get always returns — has the last word.
    const { blobs } = await client().list({ prefix: 'rev/' });
    for (const { key } of blobs) await client().delete(key);
    await expect(instance().getEvents(PLATE)).rejects.toThrow(/refusing to seed/);
  });

  it('walks from rev/1 after losing the seeding race instead of re-listing', async () => {
    const seeder = instance();
    await seeder.appendEvent(tapEvent('evt-seeded-by-the-winner'));
    // First contact from a second instance, with nothing to start from: no
    // pointer yet, and a listing still stale-empty. The refused create is the
    // only strongly consistent proof rev/1 exists, so the read has to use it
    // rather than asking the listing again — which would answer empty again,
    // pay another seed-and-upload, and lose again until the read gives up.
    await client().delete('head');
    const blind = client();
    let seedAttempts = 0;
    const blindClient = {
      ...blind,
      get: blind.get.bind(blind),
      delete: blind.delete.bind(blind),
      list: async () => ({ blobs: [], directories: [] }),
      set: async (key: string, value: string, options?: unknown) => {
        if (key === 'rev/1') seedAttempts += 1;
        return (blind.set as (k: string, v: string, o?: unknown) => Promise<unknown>)(key, value, options);
      },
    } as unknown as BlobsClientStore;

    const events = await new BlobsStore(blindClient).getEvents(PLATE);
    expect(events.map((e) => e.id)).toEqual(['evt-seeded-by-the-winner']);
    expect(seedAttempts).toBe(1);
  });

  it('a second instance arriving later sees the same seed, not a re-seed', async () => {
    const a = instance();
    await a.appendEvent(tapEvent('evt-before-b'));
    const b = instance();
    const events = await b.getEvents(PLATE);
    expect(events.map((e) => e.id)).toContain('evt-before-b');
  });
});

describe('reads', () => {
  it('hands out detached copies', async () => {
    const store = instance();
    const bed = await store.getBed(PLATE);
    bed!.crossStreets = 'scribbled on';
    expect((await store.getBed(PLATE))?.crossStreets).toBe('W 138 St × Adam Clayton Powell Jr Blvd');
  });

  it('finds a revision the head pointer has not caught up with', async () => {
    const a = instance();
    await a.appendEvent(tapEvent('evt-1'));
    await a.appendEvent(tapEvent('evt-2'));
    // A pointer left behind by a racing commit, or by a pointer write that
    // never landed: reads walk forward from it with strongly consistent gets
    // rather than believing it, because a stale answer here 404s a receipt.
    await client().set('head', '1');
    const b = instance();
    expect((await b.getEvents(PLATE)).map((e) => e.id).sort()).toEqual(['evt-1', 'evt-2']);
  });

  it('reads the newest revision with no head pointer at all', async () => {
    const a = instance();
    await a.appendEvent(tapEvent('evt-listed'));
    await client().delete('head');
    const b = instance();
    expect((await b.getEvents(PLATE)).map((e) => e.id)).toEqual(['evt-listed']);
  });

  it('one instance reads what another just committed', async () => {
    const a = instance();
    const b = instance();
    await a.appendEvent(tapEvent('evt-cross-instance'));
    const events = await b.getEvents(PLATE, 'tap');
    expect(events.map((e) => e.id)).toContain('evt-cross-instance');
  });
});

describe('transactions', () => {
  it('commits all writes together', async () => {
    const store = instance();
    const number = await store.transaction(async (tx) => {
      await tx.appendEvent(tapEvent('evt-tx'));
      return tx.nextReportNumber();
    });
    expect(number).toBe(2217);
    const fresh = instance();
    expect((await fresh.getEvents(PLATE)).map((e) => e.id)).toContain('evt-tx');
    expect(await fresh.nextReportNumber()).toBe(2218);
  });

  it('keeps nothing a failed callback wrote', async () => {
    const store = instance();
    await expect(
      store.transaction(async (tx) => {
        await tx.appendEvent(tapEvent('evt-doomed'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.getEvents(PLATE)).toHaveLength(0);
    // The store is not poisoned: the chain accepts the next transaction.
    await store.appendEvent(tapEvent('evt-after-failure'));
    expect((await store.getEvents(PLATE)).map((e) => e.id)).toEqual(['evt-after-failure']);
  });

  it('re-runs the callback when another instance commits first', async () => {
    const a = instance();
    const b = instance();
    let attempts = 0;
    await a.transaction(async (tx) => {
      attempts += 1;
      // First attempt only: another instance commits between a's read and
      // a's write, so a's onlyIfNew commit must lose and re-run.
      if (attempts === 1) await b.appendEvent(tapEvent('evt-from-b'));
      await tx.appendEvent(tapEvent(`evt-from-a-${attempts}`));
    });
    expect(attempts).toBe(2);
    const ids = (await instance().getEvents(PLATE)).map((e) => e.id).sort();
    // Both survive, and the first attempt's write is nowhere to be seen.
    expect(ids).toEqual(['evt-from-a-2', 'evt-from-b']);
  });

  it('gives up rather than spinning when every commit loses', async () => {
    const a = instance();
    const b = instance();
    let attempts = 0;
    await expect(
      a.transaction(async (tx) => {
        attempts += 1;
        await b.appendEvent(tapEvent(`evt-b-${attempts}`));
        await tx.appendEvent(tapEvent('evt-a-never'));
      }),
    ).rejects.toThrow(/optimistic commits/);
    expect(attempts).toBe(5);
    const ids = (await instance().getEvents(PLATE)).map((e) => e.id);
    expect(ids).not.toContain('evt-a-never');
  });

  it('serializes transactions within one instance instead of burning retries', async () => {
    const store = instance();
    // Ten concurrent counter bumps through one instance: the local queue
    // must line them up, so every number is minted exactly once.
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () => store.nextReportNumber()),
    );
    expect([...new Set(numbers)].sort()).toEqual(numbers.sort());
    expect(Math.max(...numbers)).toBe(2226);
  });
});

describe('pruning', () => {
  it('sweeps an orphan that no later commit deletes by key', async () => {
    const store = instance();
    for (let i = 0; i < 10; i += 1) await store.appendEvent(tapEvent(`evt-prune-a-${i}`));
    // What an instance recycled between its commit and its prune leaves
    // behind: a revision below the window that every later commit's single
    // targeted delete misses, and that delete-on-absent never reports.
    await client().set('rev/2', 'orphaned');
    for (let i = 0; i < 3; i += 1) await store.appendEvent(tapEvent(`evt-prune-b-${i}`));
    expect(await revisionKeys()).toContain('rev/2');
    for (let i = 0; i < 2; i += 1) await store.appendEvent(tapEvent(`evt-prune-c-${i}`));
    expect(await revisionKeys()).not.toContain('rev/2');
  });

  it('keeps a fixed window of revisions behind the newest', async () => {
    const store = instance();
    // Seed is rev/1 and each commit adds one, so ten taps land on rev/11.
    for (let i = 1; i <= 10; i++) await store.appendEvent(tapEvent(`evt-${i}`));
    const { blobs } = await client().list({ prefix: 'rev/' });
    const kept = blobs.map(({ key }) => Number(key.slice('rev/'.length))).sort((a, b) => a - b);
    expect(kept).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    // Pruning is bookkeeping behind the newest revision, never over it.
    expect((await instance().getEvents(PLATE)).map((e) => e.id)).toHaveLength(10);
  });
});

describe('the Spanish species casing remediation', () => {
  // scripts/rewrite-species-casing.mjs, against the same wire protocol the
  // pilot store speaks. The rewrite rule itself is held in
  // tests/species-casing.test.ts; what these hold is the store side of it —
  // it appends a revision and deletes nothing.
  async function storeSeededCapitalized(): Promise<void> {
    const store = instance();
    await store.transaction(async (tx) => {
      const bed = await tx.getBed(PLATE);
      await tx.updateBed({ ...bed!, treeType: { ...bed!.treeType, es: 'Roble sauce' } });
    });
  }

  it('appends a forward revision that lowercases the seeded name, keeping the old ones', async () => {
    await storeSeededCapitalized();
    const before = await revisionKeys();
    expect((await instance().getBed(PLATE))!.treeType.es).toBe('Roble sauce');

    const { changes, committed } = await rewriteStoredSpeciesCasing(client(), { commit: true });

    expect(changes).toEqual([{ plate: PLATE, from: 'Roble sauce', to: 'roble sauce' }]);
    expect((await instance().getBed(PLATE))!.treeType.es).toBe('roble sauce');
    // Nothing is wiped: every revision that was there still is, plus the new one.
    const after = await revisionKeys();
    for (const key of before) expect(after).toContain(key);
    expect(after).toContain(`rev/${committed}`);
  });

  it('writes nothing on a second run, and nothing at all in a dry run', async () => {
    await storeSeededCapitalized();
    await rewriteStoredSpeciesCasing(client(), { commit: true });
    const after = await revisionKeys();

    const second = await rewriteStoredSpeciesCasing(client(), { commit: true });
    expect(second.changes).toEqual([]);
    expect(second.committed).toBeNull();
    expect(await revisionKeys()).toEqual(after);

    // And a dry run on a store that does need it reports without committing.
    await storeSeededCapitalized();
    const keys = await revisionKeys();
    const dry = await rewriteStoredSpeciesCasing(client());
    expect(dry.changes).toHaveLength(1);
    expect(dry.committed).toBeNull();
    expect(await revisionKeys()).toEqual(keys);
    expect((await instance().getBed(PLATE))!.treeType.es).toBe('Roble sauce');
  });
});

describe('per-request reads', () => {
  it('validates once per request and shows every read the same revision', async () => {
    const reader = instance();
    const writer = instance();
    await reader.getBed(PLATE); // Warm the instance the way a first tap would.
    await runInRequestContext(async () => {
      const before = await reader.getEvents(PLATE);
      // Another instance commits mid-render: a screen must not show one read
      // taken before it and the next taken after it.
      await writer.appendEvent(tapEvent('evt-mid-render'));
      const after = await reader.getEvents(PLATE);
      expect(after).toEqual(before);
    });
    expect((await reader.getEvents(PLATE)).map((e) => e.id)).toEqual(['evt-mid-render']);
  });

  it('reads its own write inside the request that made it', async () => {
    const store = instance();
    await runInRequestContext(async () => {
      await store.appendEvent(tapEvent('evt-own-write'));
      expect((await store.getEvents(PLATE)).map((e) => e.id)).toEqual(['evt-own-write']);
    });
  });

  it('re-runs a transaction against the dataset that beat it, memo and all', async () => {
    const a = instance();
    const b = instance();
    await runInRequestContext(async () => {
      // The memo must not survive a lost commit: re-running the callback
      // against the dataset it already read would burn every attempt.
      await a.getEvents(PLATE);
      let attempts = 0;
      await a.transaction(async (tx) => {
        attempts += 1;
        if (attempts === 1) await b.appendEvent(tapEvent('evt-from-b'));
        await tx.appendEvent(tapEvent(`evt-from-a-${attempts}`));
      });
      expect(attempts).toBe(2);
      expect((await a.getEvents(PLATE)).map((e) => e.id).sort()).toEqual(['evt-from-a-2', 'evt-from-b']);
    });
  });
});

describe('service rules across instances', () => {
  it('two instances racing to file keep the single-open-report rule', async () => {
    const a = instance();
    const b = instance();
    // The production race, made deterministic: a's reportProblem passes its
    // rule checks against a dataset b then commits a report into. a's commit
    // must lose, and the re-run against b's dataset must see b's open report —
    // the check that passed on stale state never reaches the store. What the
    // re-run then does is add a's weight to b's report rather than open a
    // second one, which is the whole point of the single-open-report rule: two
    // open reports on a bed is unrecoverable through the UI.
    // (Truly simultaneous commits would exercise the same path, but the
    // emulated server's create-if-absent has a check-then-write window that
    // production does not, so the interleaving is pinned down instead.)
    let raced = false;
    const racy = Object.create(a) as BlobsStore;
    racy.transaction = (fn) =>
      a.transaction(async (tx) => {
        if (!raced) {
          raced = true;
          await reportProblem(b, {
            plate: PLATE,
            actorId: 'visitor-b',
            categories: ['guard'],
            note: '',
            photoAttached: false,
          });
        }
        return fn(tx);
      });
    const outcome = await reportProblem(racy, {
      plate: PLATE,
      actorId: 'visitor-a',
      categories: ['litter'],
      note: '',
      photoAttached: false,
    });
    expect(outcome.kind).toBe('added-weight');
    expect(raced).toBe(true);
    // Whatever the interleaving, the store holds exactly one open report — b's,
    // carrying a's weight.
    const fresh = instance();
    const open = await fresh.getOpenReport(PLATE);
    expect(open?.reporterId).toBe('visitor-b');
    expect(open?.categories).toEqual(['guard']);
    expect(open?.confirmedBy).toEqual(['visitor-a']);
    expect((await fresh.getReports(PLATE)).length).toBe(1);
  });
});
