// BlobsStore, proven against a real Netlify Blobs server.
//
// @netlify/blobs ships `BlobsServer` — the same HTTP surface production
// speaks, backed by a local directory — so these tests exercise the actual
// wire path: conditional GETs, `onlyIfNew` seeding, and the `onlyIfMatch`
// commits the optimistic transaction depends on. Nothing here is mocked.
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
import { RuleError, fileReport } from '../src/lib/service';
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

function tapEvent(id: string): BedEvent {
  return {
    id,
    bedPlate: PLATE,
    eventType: 'tap',
    severity: null,
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
    expect(marisol?.name).toBe('Marisol R.');
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
      // a's write, so a's onlyIfMatch commit must lose and re-run.
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

describe('service rules across instances', () => {
  it('two instances racing to file keep the single-open-report rule', async () => {
    const a = instance();
    const b = instance();
    // The production race, made deterministic: a's fileReport passes its
    // rule checks against a dataset b then commits a report into. a's commit
    // must lose, and the re-run against b's dataset must refuse — the check
    // that passed on stale state never reaches the store.
    // (Truly simultaneous commits would exercise the same path, but the
    // emulated server's create-if-absent has a check-then-write window that
    // production does not, so the interleaving is pinned down instead.)
    let raced = false;
    const racy = Object.create(a) as BlobsStore;
    racy.transaction = (fn) =>
      a.transaction(async (tx) => {
        if (!raced) {
          raced = true;
          await fileReport(b, { plate: PLATE, actorId: 'visitor-b', severity: 'heavy', photoAttached: false });
        }
        return fn(tx);
      });
    await expect(
      fileReport(racy, { plate: PLATE, actorId: 'visitor-a', severity: 'light', photoAttached: false }),
    ).rejects.toMatchObject({ code: 'open-report-exists' });
    expect(raced).toBe(true);
    // Whatever the interleaving, the store holds exactly one open report.
    const fresh = instance();
    expect((await fresh.getOpenReport(PLATE))?.severity).toBe('heavy');
    expect((await fresh.getReports(PLATE)).length).toBe(1);
  });
});
