// Domain types for the tree bed network.
// Mirrors spec §4 (beds / adoptions / reports / events), trimmed to what the
// tap flow actually reads and writes. `events` is append-only — rows are never
// updated or deleted (spec §4).

import type { Phrase } from './i18n';
import type { ProblemCategory } from './problem';

export type Severity = 'light' | 'heavy' | 'dumping';

/**
 * A run of beds the team manages as one thing — one side of one street,
 * addressed the way the captain says it: "708 W 171st between Fort Washington
 * and Haven".
 *
 * The block is an ADMIN grouping, not a public one: no visitor screen renders
 * it, and it is deliberately not the group-theming seam (presentation.ts owns
 * that, and theming is a later task). What it carries is what the block admin
 * page needs — which beds belong together, in what order along the street,
 * and the typed reference address at the top of the page.
 */
export interface Block {
  /** Slug, and the admin URL segment: `w-171-fort-washington-haven`. */
  id: string;
  /**
   * The address the admin page is headed by — TYPED, not derived
   * (design-record.md, constraint 10): a block spans several building
   * numbers, so which one names it is the captain's call, editable in place.
   */
  referenceAddress: string;
  /**
   * True for the pilot's demo bed's block: real records and a real tag, but
   * not a block the captain is preparing. The admin page badges it so a fake
   * bed can never silently read as part of a real street.
   */
  demo: boolean;
  createdAt: string;
}

export interface Bed {
  /**
   * Plate-format ID, e.g. BED-HRL-0847 — how the store keys the site.
   *
   * INTERNAL. It encodes site type and neighbourhood, and the tap flow does
   * not render it: public screens key off NYC Parks' planting space ID below
   * (design-record.md, constraint 6). It survives as the join key every
   * report, adoption and event hangs on, which is what lets a stolen tag be
   * replaced and a tree be replanted without losing history.
   */
  plate: string;
  /**
   * NYC Parks' planting space (tree bed) ID — the PUBLIC identity, rendered as
   * `#15850293`.
   *
   * The bed rather than the tree, deliberately: planting spaces persist while
   * trees churn through retirement and stumps, so an adoption keyed to the bed
   * survives a replanting. Null where we hold a bed NYC's data has no record
   * of yet; screens then print no number rather than falling back to `plate`,
   * which is ours and is not for showing.
   */
  plantingSpaceId: string | null;
  /**
   * NYC's stable GUID for the same planting space (`globalid` in the
   * Forestry Planting Spaces dataset, issue #14). The numeric `objectid`
   * above is the display identity; this is the key a future sync would
   * re-read the record by, so it is kept from the moment a bed is matched
   * rather than re-derived later. Recording it resolves nothing about how a
   * sync behaves — issue #14's questions stay open, and the sync itself is a
   * later task. Null where no NYC record has been matched.
   */
  plantingSpaceGlobalId: string | null;
  /**
   * The species common name, as the headline says it: "This <Willow Oak>'s bed
   * is looking for a steward."
   *
   * Bilingual because the headline is. NYC's data supplies the English name;
   * the Spanish defaults from the checked-in species table (tree-species.ts)
   * when a bed is added, with an explicitly supplied name winning over it and
   * an unknown species degrading to the generic "árbol". A stored record from
   * before the table may still repeat `en` in `es`; that stands rather than
   * being backfilled, because an identical pair is also what an admin who
   * typed both deliberately looks like.
   */
  treeType: Phrase;
  /** City forestry tree id. Internal; the tree churns, the bed does not. */
  treeId: string;
  /**
   * The name the bed's FIRST steward gave it, or null for a bed nobody has
   * named. It is the bed's name, not the steward's profile: releasing or
   * removing the steward who chose it changes nothing here, and only the
   * block admin can take it back to null (`saveBlockSettings`).
   *
   * Visitor-supplied free text, rendered as typed in BOTH languages — a name
   * is not translated — and always as its own leaf beside the bed's identity,
   * never spliced into a bilingual sentence. Bounded by `MAX_BED_NAME_CHARS`
   * (service.ts) like every other typed field.
   */
  bedName: string | null;
  /**
   * NFC chip serial of the tag installed with the guard, e.g. 04:A2:2F:9C.
   * Provenance only, and not the site's tag identity: which tag speaks for a
   * site is the binding's to answer (tag-bindings.ts), so a stolen tag retired
   * and replaced leaves this field saying nothing anyone should read. Never
   * rendered as the tag's ID.
   */
  tagUid: string;
  /** Displayed on the door screens as the locality; see presentation.ts. */
  crossStreets: string;
  /** Stored, never displayed (spec §2). */
  address: string;
  /** Max stewards. Default 2; a third slot can open later (spec §2). */
  slots: number;
  /**
   * How many of `slots` are OFFERED for adoption — the admin page's per-slot
   * switches, stored as a count because slots have no identity of their own
   * (a steward takes "a slot", never "slot 3"). A filled slot counts as
   * offered; `0` is a bed the captain has not put up for adoption at all.
   * `adoptBed` refuses past this bound exactly as it refuses past `slots`,
   * because a switch that only changed a screen would be no rule at all
   * (spec §7).
   */
  offeredSlots: number;
  /**
   * The guard standing at this bed, as the captain asked it: "guard there yes
   * or no, and if there is a guard there, whether it wood or metal". One field
   * answers both — `'none'` is no guard, and a material is a guard. Replaces
   * the earlier ordered/installed date pair (whose values older stored rows
   * still carry, untouched — normalization is additive); a record from before
   * this field reads as `'none'` and the admin sets the material when a guard
   * goes in.
   */
  guard: GuardMaterial;
  /**
   * The bed's own profile — what a passer-by reading "About this bed" is told,
   * because every bed is different (the captain: "every tree is specialized").
   * The four facts are the admin page's switches; the three notes are
   * admin-typed free text, rendered AS TYPED in both languages (a plant list
   * is not translated), each its own leaf on the screen and bounded by
   * `MAX_BED_NOTE_CHARS` (service.ts) like every other typed field.
   */
  /** Whether a tree currently stands in this bed. Stumps and empty pits are real states. */
  treePresent: boolean;
  /** Whether anything is planted in the bed besides the tree. */
  plantsPresent: boolean;
  /** What is planted, when `plantsPresent` — admin-typed, shown as typed. */
  plantsNote: string;
  /** Whether Trash Talk recommends planting in this bed. */
  plantingRecommended: boolean;
  /** What to plant, when `plantingRecommended` — admin-typed, shown as typed. */
  recommendedPlantsNote: string;
  /** The care this bed needs right now — admin-typed, shown as typed. */
  careNote: string;
  /**
   * The block this bed belongs to and where it stands in it, or null for a
   * bed outside any block. Admin-only grouping — see `Block`.
   */
  blockId: string | null;
  /** 1-based position along the block; the admin list's order. */
  blockPosition: number | null;
  /**
   * When NYC's open data was last read for this bed. Null until a sync runs —
   * no sync is built yet, and this is the field it will write.
   */
  nycSyncedAt: string | null;
  /**
   * Set when a sync finds NYC no longer publishes this planting space.
   *
   * A FLAG FOR A HUMAN AND NOTHING ELSE. The sync is read-only and additive
   * toward our own records: a bed that disappears from NYC's data is never
   * deleted, unpublished or orphaned here, and its adoption is never touched.
   * The captain was asked what should happen and answered "we don't know"
   * (design-record.md, answered open question 2), so the build takes the one
   * action that cannot destroy a live adoption — it writes down that somebody
   * should look — and does nothing else. Whoever implements the sync: do not
   * turn this into a cascade.
   */
  nycMissingSince: string | null;
}

export interface User {
  id: string;
  /** Given name. Admin-only — never rendered on a public screen. */
  firstName: string;
  /** Family name. Admin-only — the public screens show the initial only. */
  lastName: string;
  /** Handle without the leading @; rendered as @username. Public. */
  username: string;
  /**
   * bcrypt hash of the numeric PIN, or null for a steward with no sign-in
   * route (see `hasSignInRoute`). The plaintext PIN must never be stored,
   * logged, or returned in any response (see AGENTS.md — MVP auth decision).
   */
  pinHash: string | null;
  /**
   * Whether this person can sign in at all.
   *
   * False for a pen-and-paper steward: somebody who agreed on the sidewalk and
   * gave no email, which the sidewalk case requires us to allow
   * (design-record.md, answered open question 3). Recorded explicitly rather
   * than inferred from a null `pinHash`, so the state is findable the moment a
   * contact route exists — and so nothing ever reads a missing email as
   * consent to be contacted.
   */
  hasSignInRoute: boolean;
  /**
   * Whether the team is holding this record on the person's behalf, rather
   * than the person having created it. True for pen-and-paper stewards.
   */
  recordHeldOnBehalf: boolean;
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

/** How a steward came to be on the bed. The admin page shows this; the public screens do not. */
export type StewardKind = 'nfc' | 'pen-and-paper';

export interface Adoption {
  id: string;
  bedPlate: string;
  userId: string;
  adoptedAt: string;
  stewardKind: StewardKind;
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
  /**
   * What the visitor picked on the problem screen — every tile they pressed,
   * in tile order, at least one. The picker is multi-select: a bed that is
   * both thirsty and full of litter is one report, not a choice between the
   * two. Reports stored before multi-select carried a single `category`;
   * `normalizeData` reads that into a one-entry list on the way in, so an old
   * row still says what it always said.
   */
  categories: ProblemCategory[];
  /** The sentence behind "something else". Empty for the other three. */
  note: string;
  /**
   * How bad it is, or null.
   *
   * Null on everything the tap flow files: the approved problem screen asks
   * WHAT is wrong, not how bad, so nothing on the street sets this. It stays
   * on the record because escalation still writes it — `escalateReport` raises
   * a report to `dumping` — and because the crews' queue is ordered by it.
   */
  severity: Severity | null;
  openedAt: string;
  closedAt: string | null;
  /**
   * Who closed it. `closeReport` is actor-agnostic, as spec §2 asks, so this
   * can hold any actor id — but `/clear` currently admits only a signed-in
   * steward of the bed, so in the shipped build it only ever holds a user id,
   * never an anonymous `visitor-<uuid>`. See clear.ts's header and AGENTS.md.
   */
  closedBy: string | null;
  /** Severity before escalation to dumping, null if never escalated. */
  escalatedFrom: Severity | null;
  /**
   * Visitor ids who reported the same bed while this report was still open.
   *
   * The approved flow has no "confirm" button: a second neighbour reporting the
   * same open problem lands on the same thank-you takeover, and their weight is
   * added here rather than opening a duplicate report nobody could close.
   */
  confirmedBy: string[];
  /** The care sheet's optional photo. Only the fact of attachment is kept (storage is out of MVP scope). */
  photoAttached: boolean;
}

export type EventType =
  | 'tap'
  | 'report'
  | 'escalate'
  | 'confirm'
  | 'applause'
  | 'adopt'
  | 'release'
  | 'clear'
  | 'photo';

export interface BedEvent {
  id: string;
  bedPlate: string;
  eventType: EventType;
  severity: Severity | null;
  /**
   * What the person said, where the event was somebody saying something: the
   * problems they picked and the sentence they typed.
   *
   * A `confirm` carries these because the second neighbour on an open report
   * writes nothing else — their categories and their words would otherwise
   * reach nobody, on a screen that thanked them for telling us. Empty
   * everywhere else. Events written before multi-select carried a single
   * nullable `category`; `normalizeData` reads that into this list.
   */
  categories: ProblemCategory[];
  note: string;
  /**
   * The report this event is about, where it is about one: `report`,
   * `confirm`, `escalate` and `clear` all name it. The rest — `tap`,
   * `applause`, `adopt`, `release`, `photo` — are not about a report and are
   * null.
   * `report → clear → report` is a
   * supported loop on one bed, so the id is what says which lap an event
   * belongs to. Events written before this field have null and match nothing —
   * a steward sees no neighbour's words rather than the wrong lap's.
   */
  reportId: string | null;
  /** User id or anonymous visitor id. */
  actorId: string | null;
  createdAt: string;
}

/** How a steward is named on a public screen: `@marisol_r`. */
export function publicHandle(user: User): string {
  return `@${user.username}`;
}

/**
 * How a steward is named underneath the handle: `M. R.`
 *
 * Initials only, never the full name — the plaque is a public object anyone
 * can tap, and a neighbour who knows Marisol still recognises her from the
 * handle (design-record.md, constraint 5). Full name, email and phone are
 * admin-only.
 */
export function publicInitials(user: User): string {
  const parts = [user.firstName, user.lastName]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => `${[...part][0]!.toUpperCase()}.`);
  return parts.join(' ');
}

/**
 * What stands at the bed: no guard, or a guard and its material. One value
 * rather than a flag plus a material, so "wood guard with the material
 * unset" is not a state anything can hold.
 */
export const GUARD_MATERIALS = ['none', 'wood', 'metal'] as const;
export type GuardMaterial = (typeof GUARD_MATERIALS)[number];

/** Narrow a form value to a guard material; anything else is null. */
export function guardMaterialFrom(value: unknown): GuardMaterial | null {
  return (GUARD_MATERIALS as readonly unknown[]).includes(value) ? (value as GuardMaterial) : null;
}

/** Admin-only. Never render this on a public screen. */
export function fullName(user: User): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
}
