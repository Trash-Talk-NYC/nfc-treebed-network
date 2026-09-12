// The attachment must never cost the report: whatever the photo store does,
// the press goes on to file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/lib/store-local';
import { storeReportPhoto } from '../src/lib/report-photo';
import type { PhotoBlobs } from '../src/lib/store';

const PLATE = 'BED-HRL-0847';

function freshStore(): LocalStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'treebed-test-'));
  return new LocalStore(path.join(dir, 'store.json'));
}

function blobsThat(put: PhotoBlobs['putPhotoBlob']): PhotoBlobs {
  return {
    putPhotoBlob: put,
    getPhotoBlob: async () => null,
    deletePhotoBlob: async () => {},
  };
}

const photo = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };

describe('storing a care report’s attached photo', () => {
  let store: LocalStore;
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store = freshStore();
    logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logged.mockRestore();
  });

  it('writes the blob and names it for the row', async () => {
    const stored = await storeReportPhoto(store, blobsThat(async () => {}), {
      photo,
      plate: PLATE,
      actorId: 'visitor-1',
    });
    expect(stored).toMatchObject({ contentType: 'image/jpeg', bytes: 3 });
    expect(stored?.id).toMatch(/^photo-/);
  });

  it('files the report anyway when the photo store refuses the write', async () => {
    const stored = await storeReportPhoto(
      store,
      blobsThat(async () => {
        throw new Error('blobs 503');
      }),
      { photo, plate: PLATE, actorId: 'visitor-1' },
    );
    // No stored photo, no rejection: the categories and the note the visitor
    // typed still reach reportProblem, and `photoAttached` records the attempt.
    expect(stored).toBeUndefined();
    expect(logged).toHaveBeenCalledOnce();
  });

  it('files the report anyway when the rules read itself fails', async () => {
    const broken = new Proxy(store, {
      get: (target, prop, receiver) =>
        prop === 'getBed'
          ? async () => {
              throw new Error('store unavailable');
            }
          : Reflect.get(target, prop, receiver),
    });
    const stored = await storeReportPhoto(broken, blobsThat(async () => {}), {
      photo,
      plate: PLATE,
      actorId: 'visitor-1',
    });
    expect(stored).toBeUndefined();
  });

  it('writes nothing at all when no photo was attached', async () => {
    const put = vi.fn(async () => {});
    const stored = await storeReportPhoto(store, blobsThat(put), {
      photo: null,
      plate: PLATE,
      actorId: 'visitor-1',
    });
    expect(stored).toBeUndefined();
    expect(put).not.toHaveBeenCalled();
  });
});
