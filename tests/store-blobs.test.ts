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
import { CarryRefusal, carryStoredSteward } from '../scripts/steward-carry-apply.mjs';
import { fillStoredCaptainFacts } from '../scripts/captain-facts-apply.mjs';
import {
  ORPHAN_RUN_PLATES,
  retireStoredOrphanRunBeds,
} from '../scripts/orphan-run-beds-apply.mjs';
import { runInRequestContext } from '../src/lib/request-context';
import {
  adoptBed,
  consumeSignInToken,
  reportProblem,
  requestSignInLink,
} from '../src/lib/service';
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

describe('photo blobs', () => {
  it('round-trips binary bytes over the wire, outside the revision chain', async () => {
    const store = instance();
    // Bytes that would not survive a text round-trip: every value 0–255.
    const bytes = new Uint8Array(4096).map((_, i) => i % 256);
    await store.putPhotoBlob('photo-wire-1', bytes);
    const back = await store.getPhotoBlob('photo-wire-1');
    expect(back).not.toBeNull();
    expect(Buffer.from(back!).equals(Buffer.from(bytes))).toBe(true);
    // A photo the store never took is null, not an error — the serving route's
    // 404 for a blob a crash window orphaned away.
    expect(await store.getPhotoBlob('photo-nowhere')).toBeNull();
    await store.deletePhotoBlob('photo-wire-1');
    expect(await store.getPhotoBlob('photo-wire-1')).toBeNull();
  });

  it('survives the revision pruning sweep — photos live under their own prefix', async () => {
    const store = instance();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.putPhotoBlob('photo-keeper', bytes);
    // Enough commits to push pruning past its every-KEPT_REVISIONS full sweep.
    for (let i = 1; i <= 17; i += 1) await store.appendEvent(tapEvent(`evt-photo-${i}`));
    const back = await store.getPhotoBlob('photo-keeper');
    expect(back).not.toBeNull();
    expect(Buffer.from(back!).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('the species casing remediation', () => {
  // scripts/rewrite-species-casing.mjs, against the same wire protocol the
  // pilot store speaks. The rewrite rule itself is held in
  // tests/species-casing.test.ts; what these hold is the store side of it —
  // it appends a revision and deletes nothing.
  async function storeSeededCapitalized(): Promise<void> {
    const store = instance();
    await store.transaction(async (tx) => {
      const bed = await tx.getBed(PLATE);
      await tx.updateBed({ ...bed!, treeType: { en: 'Willow oak', es: 'Roble sauce' } });
    });
  }

  it('appends a forward revision that corrects both seeded names, keeping the old ones', async () => {
    await storeSeededCapitalized();
    const before = await revisionKeys();
    expect((await instance().getBed(PLATE))!.treeType).toEqual({
      en: 'Willow oak',
      es: 'Roble sauce',
    });

    const { changes, committed } = await rewriteStoredSpeciesCasing(client(), { commit: true });

    expect(changes).toEqual([
      { plate: PLATE, field: 'en', from: 'Willow oak', to: 'willow oak' },
      { plate: PLATE, field: 'es', from: 'Roble sauce', to: 'roble sauce' },
    ]);
    expect((await instance().getBed(PLATE))!.treeType).toEqual({
      en: 'willow oak',
      es: 'roble sauce',
    });
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
    expect(dry.changes).toHaveLength(2);
    expect(dry.kept.length).toBeGreaterThan(0);
    expect(dry.committed).toBeNull();
    expect(await revisionKeys()).toEqual(keys);
    expect((await instance().getBed(PLATE))!.treeType!.es).toBe('Roble sauce');
  });
});

describe('the captain-facts remediation', () => {
  // scripts/seed-captain-facts.mjs → captain-facts-apply.mjs, against the
  // same wire protocol the pilot store speaks: the captain's "with 8 and 9N
  // say no plants and don't recommend planting" reaching the two LIVE rows
  // his named ids landed on (BED-WH-1712 / BED-WH-1713), which the
  // insert-only seed can never touch.
  const RENAMED = ['BED-WH-1712', 'BED-WH-1713'] as const;

  /** The live store's shape: the rows persisted BEFORE the facts were stated. */
  async function storeWithUnrecordedFacts(): Promise<void> {
    const store = instance();
    await store.transaction(async (tx) => {
      for (const plate of RENAMED) {
        const bed = await tx.getBed(plate);
        await tx.updateBed({ ...bed!, plantsPresent: null, plantingRecommended: null });
      }
    });
  }

  it('fills the stated facts as one forward revision, deleting nothing', async () => {
    await storeWithUnrecordedFacts();
    const before = await revisionKeys();

    const { changes, committed } = await fillStoredCaptainFacts(client(), { commit: true });

    expect(committed).not.toBeNull();
    expect(changes).toHaveLength(4);
    const after = await revisionKeys();
    for (const key of before) expect(after).toContain(key);
    for (const plate of RENAMED) {
      const bed = await instance().getBed(plate);
      expect(bed!.plantsPresent, plate).toBe(false);
      expect(bed!.plantingRecommended, plate).toBe(false);
    }
  });

  it('never overwrites a value somebody has set, and a dry run writes nothing', async () => {
    await storeWithUnrecordedFacts();
    // The captain has since said 1712 IS planted: that answer must survive.
    const store = instance();
    await store.transaction(async (tx) => {
      const bed = await tx.getBed('BED-WH-1712');
      await tx.updateBed({ ...bed!, plantsPresent: true });
    });
    const keys = await revisionKeys();

    const dry = await fillStoredCaptainFacts(client());
    expect(dry.committed).toBeNull();
    expect(await revisionKeys()).toEqual(keys);

    const { changes, kept } = await fillStoredCaptainFacts(client(), { commit: true });
    expect(changes.map(({ plate, field }) => `${plate}.${field}`)).not.toContain(
      'BED-WH-1712.plantsPresent',
    );
    expect(kept.some(({ plate, field }) => plate === 'BED-WH-1712' && field === 'plantsPresent')).toBe(
      true,
    );
    expect((await instance().getBed('BED-WH-1712'))!.plantsPresent).toBe(true);
    expect((await instance().getBed('BED-WH-1712'))!.plantingRecommended).toBe(false);
  });

  it('does nothing at all on a store the seed already carried the facts into', async () => {
    await instance().getBed(PLATE); // fresh seed: the facts are already there
    const keys = await revisionKeys();
    const { changes, committed } = await fillStoredCaptainFacts(client(), { commit: true });
    expect(changes).toEqual([]);
    expect(committed).toBeNull();
    expect(await revisionKeys()).toEqual(keys);
  });
});

describe('the orphan run-bed remediation', () => {
  // scripts/retire-orphan-run-beds.mjs → orphan-run-beds-apply.mjs. PR #29
  // seeded 8NHFW171 and 9NHFW171 as fresh beds and deployed; the captain's
  // rename then made those ids names for BED-WH-1713 / BED-WH-1712, so the
  // seed stopped minting them and the live rows were left reachable by no
  // tag. Retiring them is reversible from the admin; deleting them would not
  // be, and a row a person has touched is not this script's to tidy away.

  /** The live store as PR #29 left it: the two blank rows, seeded and stranded. */
  async function storeWithOrphanRows(): Promise<void> {
    const store = instance();
    const template = (await store.getBed('1NHFW171'))!;
    await store.transaction(async (tx) => {
      for (const [i, plate] of ORPHAN_RUN_PLATES.entries()) {
        await tx.createBed({
          ...template,
          plate,
          guard: null,
          blockPosition: 8 + i,
          retiredAt: null,
        });
      }
    });
  }

  it('retires both blank rows as one forward revision, deleting nothing', async () => {
    await storeWithOrphanRows();
    const before = await revisionKeys();

    const { changes, committed } = await retireStoredOrphanRunBeds(client(), { commit: true });

    expect(committed).not.toBeNull();
    expect(changes.map(({ plate }) => plate)).toEqual([...ORPHAN_RUN_PLATES]);
    // Nothing is wiped: every revision that was there still is, plus the new one.
    const after = await revisionKeys();
    for (const key of before) expect(after).toContain(key);
    for (const plate of ORPHAN_RUN_PLATES) {
      // The row stays — retired, not erased, so the admin can restore it.
      const bed = await instance().getBed(plate);
      expect(bed, plate).not.toBeNull();
      expect(bed!.retiredAt, plate).not.toBeNull();
    }

    // A second run has nothing to do, and commits nothing.
    const keys = await revisionKeys();
    const second = await retireStoredOrphanRunBeds(client(), { commit: true });
    expect(second.changes).toEqual([]);
    expect(second.committed).toBeNull();
    expect(await revisionKeys()).toEqual(keys);
  });

  it('refuses a row somebody adopted, then retires it once the steward is carried off', async () => {
    await storeWithOrphanRows();
    const [adopted, blank] = ORPHAN_RUN_PLATES;
    // A neighbour adopted the blank duplicate while PR #29 was live.
    const steward = await adoptBed(instance(), {
      plate: adopted!,
      input: { firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.invalid', phone: '' },
    });

    const first = await retireStoredOrphanRunBeds(client(), { commit: true });

    expect(first.changes.map(({ plate }) => plate)).toEqual([blank]);
    expect(first.kept.find(({ plate }) => plate === adopted)!.reason).toMatch(
      /active adoption.*carry-steward/,
    );
    // Left byte-for-byte: the person's bed is still live and still theirs.
    expect((await instance().getBed(adopted!))!.retiredAt).toBeNull();
    expect((await instance().getBed(blank!))!.retiredAt).not.toBeNull();

    // The instructed recovery: carry the steward off, then re-run. The carry
    // leaves its released adoption keyed to the plate it was written on, and
    // that must not refuse the retire a second time.
    await carryStoredSteward(
      client(),
      { user: steward.id, from: adopted!, to: PLATE },
      { commit: true },
    );

    const second = await retireStoredOrphanRunBeds(client(), { commit: true });
    expect(second.changes.map(({ plate }) => plate)).toEqual([adopted]);
    // And the report names what the tombstone still holds, so nobody has to
    // guess that a released adoption and its events went with it.
    expect(second.changes[0]!.carries.join(', ')).toMatch(/released adoption/);
    expect((await instance().getBed(adopted!))!.retiredAt).not.toBeNull();
  });

  it('retires a row somebody edited, naming the edit, and writes nothing in a dry run', async () => {
    await storeWithOrphanRows();
    const [edited] = ORPHAN_RUN_PLATES;
    const store = instance();
    await store.transaction(async (tx) => {
      const bed = await tx.getBed(edited!);
      await tx.updateBed({ ...bed!, guard: 'wood' });
    });
    const keys = await revisionKeys();

    const dry = await retireStoredOrphanRunBeds(client());
    expect(dry.committed).toBeNull();
    // An edit is kept by the retire, not a refusal — it is disclosed instead.
    expect(dry.changes.find(({ plate }) => plate === edited)!.carries.join(', ')).toMatch(/guard/);
    expect(await revisionKeys()).toEqual(keys);
    for (const plate of ORPHAN_RUN_PLATES) {
      expect((await instance().getBed(plate))!.retiredAt, plate).toBeNull();
    }
  });

  it('does nothing on a store seeded after the rename, where no row was orphaned', async () => {
    await instance().getBed(PLATE); // fresh seed: the plates were never minted
    const keys = await revisionKeys();
    const { changes, kept, committed } = await retireStoredOrphanRunBeds(client(), { commit: true });
    expect(changes).toEqual([]);
    expect(committed).toBeNull();
    expect(kept).toHaveLength(ORPHAN_RUN_PLATES.length);
    expect(await revisionKeys()).toEqual(keys);
  });
});

describe('the steward carry remediation', () => {
  // scripts/carry-steward.mjs → steward-carry-apply.mjs, against the same
  // wire protocol the pilot store speaks. The rule itself is held in
  // tests/steward-carry.test.ts; what these hold is the store side — it
  // appends a forward revision, deletes nothing, and reverses cleanly. The
  // seeded store already holds a real adoption (marisol on the demo bed), so
  // this is the captain's own scenario shape end to end.
  const SEEDED_ADOPTED_AT = '2026-05-02T14:00:00.000Z';
  const NAMED_PLATE = '3NHFW171';

  it('carries the seeded steward to a named-run bed and back, one forward revision each way', async () => {
    await instance().getBed(PLATE); // first contact seeds the store
    const before = await revisionKeys();

    const carried = await carryStoredSteward(
      client(),
      { user: 'marisol_r', from: PLATE, to: NAMED_PLATE },
      { commit: true },
    );
    expect(carried.committed).not.toBeNull();
    // Nothing is wiped: every revision that was there still is.
    const after = await revisionKeys();
    for (const key of before) expect(after).toContain(key);

    // A fresh instance — another function — sees the adoption whole on the
    // named bed: same person, same adoptedAt, and the old bed released.
    const moved = await instance().getActiveAdoptions(NAMED_PLATE);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.userId).toBe('user-marisol');
    expect(moved[0]!.adoptedAt).toBe(SEEDED_ADOPTED_AT);
    expect(await instance().getActiveAdoptions(PLATE)).toHaveLength(0);

    // Swapping --from and --to is the documented reversal.
    await carryStoredSteward(
      client(),
      { user: 'marisol_r', from: NAMED_PLATE, to: PLATE },
      { commit: true },
    );
    const restored = await instance().getActiveAdoptions(PLATE);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.adoptedAt).toBe(SEEDED_ADOPTED_AT);
    expect(await instance().getActiveAdoptions(NAMED_PLATE)).toHaveLength(0);
  });

  it('finds a run bed the live store has not persisted yet', async () => {
    // The day-one shape: the pilot store was seeded before the named runs
    // existed, so its newest revision holds none of the fresh run beds — they are
    // checked-in records every load would insert, and a commit is what
    // finally persists them. The script applies that same insert-only pass,
    // so the captain's own target is found rather than refused as a typo.
    await instance().getBed(PLATE); // first contact seeds the store
    const legacy = (await client().get('rev/1', { type: 'json' })) as {
      beds: Record<string, unknown>;
    };
    for (const plate of Object.keys(legacy.beds)) {
      if (plate !== PLATE) delete legacy.beds[plate];
    }
    await client().set('rev/2', JSON.stringify(legacy));
    await client().set('head', '2');

    const carried = await carryStoredSteward(
      client(),
      { user: 'marisol_r', from: PLATE, to: NAMED_PLATE },
      { commit: true },
    );
    expect(carried.committed).toBe(3);
    const moved = await instance().getActiveAdoptions(NAMED_PLATE);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.adoptedAt).toBe(SEEDED_ADOPTED_AT);
    // Insert-only, exactly what the next load would have written: the bed
    // the revision already held is untouched.
    const committed = (await client().get('rev/3', { type: 'json' })) as {
      beds: Record<string, { plate: string }>;
    };
    expect(committed.beds[NAMED_PLATE]!.plate).toBe(NAMED_PLATE);
    expect(committed.beds[PLATE]).toBeDefined();
  });

  it('writes nothing on a dry run, and nothing on a refusal', async () => {
    await instance().getBed(PLATE);
    const keys = await revisionKeys();

    const dry = await carryStoredSteward(client(), { user: 'marisol_r', from: PLATE, to: NAMED_PLATE });
    expect(dry.committed).toBeNull();
    expect(await revisionKeys()).toEqual(keys);
    expect(await instance().getActiveAdoptions(PLATE)).toHaveLength(1);

    // An unknown steward, an unknown bed: the rule refuses before any write.
    await expect(
      carryStoredSteward(client(), { user: 'nobody', from: PLATE, to: NAMED_PLATE }, { commit: true }),
    ).rejects.toBeInstanceOf(CarryRefusal);
    await expect(
      carryStoredSteward(client(), { user: 'marisol_r', from: PLATE, to: 'BED-XX-0000' }, { commit: true }),
    ).rejects.toBeInstanceOf(CarryRefusal);
    expect(await revisionKeys()).toEqual(keys);
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
