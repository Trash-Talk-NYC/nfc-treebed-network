// The persistence boundary.
//
// Every read/write in the app goes through this interface. It is deliberately
// narrow and storage-dumb: no business rules live here — those belong in
// service.ts, so they survive a storage swap untouched. To move to Supabase
// (or anything else) later, write one new implementation of `Store` and change
// the factory in this file — nothing else in the app should need edits.
//
// Two implementations exist, selected at runtime by `getStore()` below:
// LocalStore (a JSON file on disk — dev and tests) and
// BlobsStore (Netlify Blobs — the deployed pilot). Each owns only its
// persistence; the dataset shape and operations they share live in
// store-dataset.ts.
//
// Two contracts every implementation must honour:
//  - Reads return detached copies. Callers may mutate what they get back
//    without touching stored state; the only way to persist a change is an
//    explicit write.
//  - `transaction` gives a read-check-write sequence exclusive access, so the
//    service layer's rules (single open report, the slot cap) can't be raced
//    by a concurrent request between the check and the write.
//
// What `transaction` deliberately does NOT promise is isolation from readers.
// Reads taken outside a transaction are not queued behind it, so a page render
// can observe a write the transaction has not committed — and, if that
// transaction later rolls back, a state that never existed. Read-uncommitted,
// in database terms. It is the right trade here: every screen is a read, and
// serializing renders behind writes would put the street screen in line behind
// a disk flush. A rule must therefore never be enforced from a read taken
// outside the transaction that acts on it.

import type {
  Adoption,
  Bed,
  BedEvent,
  Block,
  NetworkSettings,
  Report,
  ReportPhoto,
  Severity,
  SignInMissWindow,
  SignInRequest,
  SignInToken,
  User,
} from './types';
import { BUILD_TARGET } from './build-target';
import { LocalStore } from './store-local';
import { BlobsStore } from './store-blobs';

export interface Store {
  /**
   * Run `fn` with exclusive access to the store, committing all of its writes
   * together. If `fn` throws, nothing it wrote is kept.
   *
   * Rules that check state before writing it MUST run inside one of these —
   * a bare sequence of store calls can interleave with another request.
   *
   * `fn` MUST do all of its reading and writing through the `tx` it is handed,
   * not through the store it came from: `tx` is what belongs to this
   * transaction, and only calls made through it are covered by the exclusive
   * access and the all-or-nothing commit.
   */
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  // -- beds ------------------------------------------------------------
  getBed(plate: string): Promise<Bed | null>;
  /** Refuses a plate that already exists — plates are the join key everything hangs on. */
  createBed(bed: Bed): Promise<void>;
  updateBed(bed: Bed): Promise<void>;

  // -- blocks (admin grouping; see types.ts `Block`) --------------------
  getBlock(id: string): Promise<Block | null>;
  /** Every block, stable order. The admin index; nothing public reads it. */
  getBlocks(): Promise<Block[]>;
  updateBlock(block: Block): Promise<void>;
  /** Beds assigned to a block, in block order. */
  getBedsInBlock(blockId: string): Promise<Bed[]>;
  /**
   * Beds owing an applause notification (`Bed.applauseNoticeDueAt`), oldest
   * claim first — what the scheduled run reads to deliver them. Retired beds
   * are left out: a bed the admin deleted mails nobody.
   */
  getBedsWithApplauseNoticeDue(): Promise<Bed[]>;

  // -- users -----------------------------------------------------------
  getUser(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  /** Case-insensitive; the sign-in link's lookup. */
  getUserByEmail(email: string): Promise<User | null>;
  /** Every user, stable order. The digest run's iteration; nothing public reads it. */
  getUsers(): Promise<User[]>;
  createUser(user: User): Promise<void>;
  updateUser(user: User): Promise<void>;

  // -- adoptions -------------------------------------------------------
  /** Active (non-released) adoptions for a bed, oldest first. */
  getActiveAdoptions(bedPlate: string): Promise<Adoption[]>;
  /** Active adoptions held by one user, oldest first — the digest's beds. */
  getActiveAdoptionsForUser(userId: string): Promise<Adoption[]>;
  createAdoption(adoption: Adoption): Promise<void>;
  /**
   * Rewrite one adoption row by id. The only field anything writes through
   * this today is `releasedAt` — the release half of carrying a steward
   * between beds (`carryStewardByAdmin`); adoptions are otherwise immutable.
   */
  updateAdoption(adoption: Adoption): Promise<void>;

  // -- reports ---------------------------------------------------------
  getOpenReport(bedPlate: string): Promise<Report | null>;
  getReport(id: string): Promise<Report | null>;
  /** All reports for a bed, newest first. */
  getReports(bedPlate: string): Promise<Report[]>;
  createReport(report: Report): Promise<void>;
  updateReport(report: Report): Promise<void>;
  /** Monotonic counter used to mint receipt numbers (RPT-XXXX-…). */
  nextReportNumber(): Promise<number>;

  // -- stored care photos (metadata; the bytes live behind PhotoBlobs) --
  getReportPhoto(id: string): Promise<ReportPhoto | null>;
  /** A report's photos, oldest first — what bounds `MAX_REPORT_PHOTOS`. */
  getReportPhotosForReport(reportId: string): Promise<ReportPhoto[]>;
  /** A bed's photos, newest first — the admin panel's read. */
  getReportPhotosForBed(bedPlate: string): Promise<ReportPhoto[]>;
  addReportPhoto(photo: ReportPhoto): Promise<void>;
  /** The admin's moderation control. Deletes the row; the blob is the caller's. */
  deleteReportPhoto(id: string): Promise<void>;

  // -- events (append-only — there is deliberately no update/delete) ---
  appendEvent(event: BedEvent): Promise<void>;
  /** Events for a bed, newest first, optionally filtered by type. */
  getEvents(bedPlate: string, eventType?: BedEvent['eventType']): Promise<BedEvent[]>;

  // -- sign-in links (hashed; the raw token never reaches the store) ---
  getSignInToken(tokenHash: string): Promise<SignInToken | null>;
  createSignInToken(token: SignInToken): Promise<void>;
  deleteSignInToken(tokenHash: string): Promise<void>;
  /** Housekeeping: drop rows whose expiry is at or before `now` (ISO). */
  deleteSignInTokensExpiredBy(now: string): Promise<void>;

  // -- sign-in rate limit window (hashed emails; see types.ts) ---------
  getSignInRequestsSince(since: string): Promise<SignInRequest[]>;
  appendSignInRequest(request: SignInRequest): Promise<void>;
  /** Housekeeping: drop rows older than the rate-limit window. */
  deleteSignInRequestsBefore(cutoff: string): Promise<void>;
  /** The bed's unresolved-attempt counter for the current window, if any. */
  getSignInMissWindow(bedPlate: string): Promise<SignInMissWindow | null>;
  /** Write the bed's counter, replacing whatever window it held. */
  putSignInMissWindow(window: SignInMissWindow): Promise<void>;

  // -- network settings (the admin's digest cadence) --------------------
  getNetworkSettings(): Promise<NetworkSettings>;
  updateNetworkSettings(settings: NetworkSettings): Promise<void>;
}

export type {
  Adoption,
  Bed,
  BedEvent,
  Block,
  NetworkSettings,
  Report,
  ReportPhoto,
  Severity,
  SignInMissWindow,
  SignInRequest,
  SignInToken,
  User,
};

/**
 * Where a stored photo's BYTES live — deliberately not part of `Store`:
 * the dataset is committed whole per revision, and a photo is megabytes, so
 * the blob sits beside the dataset (a file under `.data/photos/` locally, a
 * `photo/<id>` blob on Netlify) and the dataset holds only the `ReportPhoto`
 * row. That split is also why these are not transactional: a blob is written
 * BEFORE the transaction that records its row (report.ts) and deleted after
 * the one that removes it, so the row never points at bytes that were never
 * stored — the failure that can happen is an orphan blob no row names, which
 * is invisible and cheap, rather than a broken image on the admin panel.
 */
export interface PhotoBlobs {
  putPhotoBlob(id: string, bytes: Uint8Array): Promise<void>;
  getPhotoBlob(id: string): Promise<Uint8Array | null>;
  deletePhotoBlob(id: string): Promise<void>;
}

let instance: (Store & PhotoBlobs) | null = null;

/**
 * The app-wide store, selected by TREEBED_STORE:
 *
 *  - `blobs`  — Netlify Blobs (store-blobs.ts); set on the deployed site,
 *               where a function instance has no disk that outlives it.
 *  - `local`, or unset — the local JSON file. Dev and the test suites stay on
 *               disk without configuring anything.
 *
 * The variable is explicit rather than sniffed from Netlify's environment so
 * a deploy is never one platform-rename away from silently writing to a
 * filesystem that forgets. That only holds if a wrong value is loud, so this
 * is the same two-sided check TREEBED_SESSION_SECRET gets: an unrecognized
 * value is refused rather than quietly read as `local`, and on the netlify
 * target the disk store is refused outright — there it either throws EROFS on
 * every route or, worse, keeps a per-instance dataset that forgets between
 * invocations. preflight.mjs does not run for functions, so the assertion
 * lives where the choice is made and fires on the first request to need it.
 */
export function getStore(): Store {
  instance ??= createStore();
  return instance;
}

/**
 * The photo-blob half of the same backend. The same singleton as `getStore()`,
 * exposed as its own narrow interface so the transaction facade never has to
 * pretend blobs are transactional (`TransactionStore` implements `Store` and
 * nothing else).
 */
export function getPhotoBlobs(): PhotoBlobs {
  instance ??= createStore();
  return instance;
}

function createStore(): Store & PhotoBlobs {
  const configured = process.env.TREEBED_STORE || 'local';
  if (configured !== 'blobs' && configured !== 'local') {
    throw new Error(
      `TREEBED_STORE must be 'blobs' or 'local' (got '${configured}') — refusing to guess which backend a deploy meant.`,
    );
  }
  if (BUILD_TARGET === 'netlify' && configured !== 'blobs') {
    throw new Error(
      "TREEBED_STORE must be 'blobs' on the netlify target — a function instance has no disk that outlives the request, so the local store would forget every write.",
    );
  }
  return configured === 'blobs' ? new BlobsStore() : new LocalStore();
}
