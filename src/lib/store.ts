// The persistence boundary.
//
// Every read/write in the app goes through this interface. It is deliberately
// narrow and storage-dumb: no business rules live here — those belong in
// service.ts, so they survive a storage swap untouched. To move to Supabase
// (or anything else) later, write one new implementation of `Store` and change
// the factory in store-local.ts — nothing else in the app should need edits.
//
// The only local implementation is store-local.ts, backed by a JSON file on
// disk. It is intentionally the single file that knows how data is persisted.

import type { Adoption, Bed, BedEvent, Report, Severity, User } from './types';

export interface Store {
  // -- beds ------------------------------------------------------------
  getBed(plate: string): Promise<Bed | null>;

  // -- users -----------------------------------------------------------
  getUser(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  createUser(user: User): Promise<void>;
  updateUser(user: User): Promise<void>;

  // -- adoptions -------------------------------------------------------
  /** Active (non-released) adoptions for a bed, oldest first. */
  getActiveAdoptions(bedPlate: string): Promise<Adoption[]>;
  createAdoption(adoption: Adoption): Promise<void>;

  // -- reports ---------------------------------------------------------
  getOpenReport(bedPlate: string): Promise<Report | null>;
  getReport(id: string): Promise<Report | null>;
  /** All reports for a bed, newest first. */
  getReports(bedPlate: string): Promise<Report[]>;
  createReport(report: Report): Promise<void>;
  updateReport(report: Report): Promise<void>;
  /** Monotonic counter used to mint receipt numbers (RPT-XXXX-…). */
  nextReportNumber(): Promise<number>;

  // -- events (append-only — there is deliberately no update/delete) ---
  appendEvent(event: BedEvent): Promise<void>;
  /** Events for a bed, newest first, optionally filtered by type. */
  getEvents(bedPlate: string, eventType?: BedEvent['eventType']): Promise<BedEvent[]>;
}

export type { Adoption, Bed, BedEvent, Report, Severity, User };
