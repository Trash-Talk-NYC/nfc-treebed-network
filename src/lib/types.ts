// Domain types for the tree bed network.
// Mirrors spec §4 (beds / adoptions / reports / events), trimmed to what the
// MVP tap screen actually reads and writes. `events` is append-only — rows
// are never updated or deleted (spec §4).

export type Severity = 'light' | 'heavy' | 'dumping';

export interface Bed {
  /** Plate-format ID, e.g. BED-HRL-0847. Also the URL segment. */
  plate: string;
  /** City forestry tree id shown under the plate, e.g. 08-4211. */
  treeId: string;
  /** NFC chip serial shown under the plate, e.g. 04:A2:2F:9C. */
  tagUid: string;
  /** Displayed on adopter-facing screens; the street address is NOT displayed (spec §2). */
  crossStreets: string;
  /** Stored, never displayed (spec §2). */
  address: string;
  /** Max adopters. Default 2; a third slot can open later (spec §2). */
  slots: number;
  guardInstalledAt: string;
}

export interface User {
  id: string;
  name: string;
  /** Handle without the leading @; rendered as @username. */
  username: string;
  /**
   * bcrypt hash of the numeric PIN. The plaintext PIN must never be stored,
   * logged, or returned in any response (see AGENTS.md — MVP auth decision).
   */
  pinHash: string;
  /** PII — stored only, never rendered on any public screen or payload. */
  email: string;
  /** PII — stored only, never rendered on any public screen or payload. */
  phone: string;
  /** Rendered from stored values; earning rules are out of MVP scope. */
  points: number;
  /** Weekly photo streak, in weeks. Rendered from stored values only. */
  streakWeeks: number;
  createdAt: string;
}

export interface Adoption {
  id: string;
  bedPlate: string;
  userId: string;
  adoptedAt: string;
  displayNameHidden: boolean;
  releasedAt: string | null;
}

export interface Report {
  /** Receipt-format id, e.g. RPT-2216-0847. */
  id: string;
  bedPlate: string;
  /**
   * Who filed it: a user id, or an anonymous visitor id from the signed
   * cookie. Nullable in spec §4; here every request carries an identity so
   * the one-report-per-person-per-day rule is enforceable.
   */
  reporterId: string;
  severity: Severity;
  openedAt: string;
  closedAt: string | null;
  /** Anyone can mark clear, not just adopters (spec §2). */
  closedBy: string | null;
  /** Severity before escalation to dumping, null if never escalated. */
  escalatedFrom: Severity | null;
  /** Visitor ids who pressed "STILL THERE — CONFIRM IT". One entry per person. */
  confirmedBy: string[];
  /** The report sheet's optional photo. Only the fact of attachment is kept (storage is out of MVP scope). */
  photoAttached: boolean;
}

export type EventType =
  | 'tap'
  | 'report'
  | 'escalate'
  | 'confirm'
  | 'adopt'
  | 'release'
  | 'clear'
  | 'photo';

export interface BedEvent {
  id: string;
  bedPlate: string;
  eventType: EventType;
  severity: Severity | null;
  /** User id or anonymous visitor id. */
  actorId: string | null;
  createdAt: string;
}
