// What getStore() refuses to do, and why it refuses instead of guessing.
//
// TREEBED_STORE is the other deploy-critical variable beside the session
// secret, and preflight.mjs — the only thing that runs before the port binds —
// never runs for a Netlify function. So the assertion lives where the backend
// is chosen, and these are the two ways a deploy gets it wrong: a value nobody
// implements, and the disk store on a platform with no disk.

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** A fresh module graph each time: the factory memoizes its store. */
async function freshGetStore(target: 'node' | 'netlify' = 'node') {
  vi.resetModules();
  vi.doMock('../src/lib/build-target', () => ({ BUILD_TARGET: target }));
  return (await import('../src/lib/store')).getStore;
}

describe('getStore', () => {
  it('defaults to the local store when TREEBED_STORE is unset', async () => {
    vi.stubEnv('TREEBED_STORE', undefined);
    const getStore = await freshGetStore();
    expect(getStore().constructor.name).toBe('LocalStore');
  });

  it('returns the same store on every call', async () => {
    const getStore = await freshGetStore();
    expect(getStore()).toBe(getStore());
  });

  it('refuses a value it does not implement rather than falling back to disk', async () => {
    vi.stubEnv('TREEBED_STORE', 'blob');
    const getStore = await freshGetStore();
    expect(() => getStore()).toThrow(/TREEBED_STORE must be 'blobs' or 'local'/);
  });

  it('refuses the disk store on the netlify target', async () => {
    vi.stubEnv('TREEBED_STORE', 'local');
    const getStore = await freshGetStore('netlify');
    expect(() => getStore()).toThrow(/no disk that outlives the request/);
  });

  it('takes the blobs store on the netlify target', async () => {
    vi.stubEnv('TREEBED_STORE', 'blobs');
    vi.stubEnv('NETLIFY_BLOBS_CONTEXT', btoa(JSON.stringify({
      apiURL: 'http://localhost:1',
      edgeURL: 'http://localhost:1',
      uncachedEdgeURL: 'http://localhost:1',
      siteID: 'store-factory-test',
      token: 'store-factory-token',
      primaryRegion: 'us-east-1',
    })));
    const getStore = await freshGetStore('netlify');
    expect(getStore().constructor.name).toBe('BlobsStore');
  });
});
