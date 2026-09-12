// The route-side half of a care report's optional photo: the pre-filter and
// the blob write, in one place the tests can drive with a store and a blob
// backend of their own.
import { randomUUID } from 'node:crypto';
import { reportPhotoCouldBeKept } from './service';
import type { PhotoBlobs, Store } from './store';

export interface CarriedPhoto {
  bytes: Uint8Array;
  contentType: string;
}

export interface StoredPhoto {
  id: string;
  contentType: string;
  bytes: number;
}

/**
 * Write the attached photo under a fresh server-minted id, or nothing at all
 * when the rules are about to decline the press.
 *
 * Its own module so the caller can drop the buffered body the bytes are a view
 * into as soon as this returns — and so the one thing that must never happen
 * here is testable: an optional attachment must never cost somebody the report
 * they already typed. Every failure on this path — the pre-read, the upload —
 * is logged and answered as "no stored photo", so the press goes on to file
 * with `photoAttached` still recording the attempt, exactly the degradation
 * the pre-storage build had for every photo.
 */
export async function storeReportPhoto(
  store: Store,
  blobs: PhotoBlobs,
  args: { photo: CarriedPhoto | null; plate: string; actorId: string },
): Promise<StoredPhoto | undefined> {
  const { photo, plate, actorId } = args;
  if (photo === null) return undefined;
  try {
    if (!(await reportPhotoCouldBeKept(store, { plate, actorId }))) return undefined;
    const id = `photo-${randomUUID()}`;
    await blobs.putPhotoBlob(id, photo.bytes);
    return { id, contentType: photo.contentType, bytes: photo.bytes.byteLength };
  } catch (err) {
    // No PII and no bytes: the plate is an internal key and the failure is the
    // whole message. The visitor still lands on the thank-you takeover.
    console.error(`[report] attached photo could not be stored for ${plate}:`, err);
    return undefined;
  }
}
