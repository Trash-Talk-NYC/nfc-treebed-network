// Domain types for the tree bed network.
// Mirrors spec §4 (beds / adoptions / reports / events), trimmed to what the
// tap flow actually reads and writes. `events` is append-only — rows are never
// updated or deleted (spec §4).

import type { Lang, Phrase } from './i18n';
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
   *
   * `null` is NOT YET RECORDED, the same rule as `guard` below: nobody has
   * said what stands (or belongs) in this bed. The 20 fresh captain-run beds
   * seed here — he will fill species in from NYC Parks' data; the other two
   * named ids are the renamed BED-WH-1712/1713, which keep the willow-oak
   * species they were already recorded with — and the screens
   * degrade to the generic tree (`GENERIC_TREE`) inside the door frames,
   * which stay grammatical in both languages ("This tree's bed…" / "El
   * cantero de este árbol…"), never to a guessed species and never to a
   * broken sentence. The About page states "not recorded" instead of a
   * species, because there the value is an assertion rather than a frame.
   */
  treeType: Phrase | null;
  /** City forestry tree id. Internal; the tree churns, the bed does not. */
  treeId: string;
  /**
   * The bed's given name, or null for a bed nobody has named. The FIRST
   * steward names it at adoption (`adoptBed`), and since the captain's
   * 2026-09-12 decision ANY active steward may rename it from their own view
   * (`renameBedBySteward`, each rename an event on the record). It is the
   * bed's name, not a steward's profile: releasing or removing whoever chose
   * it changes nothing here, and only the block admin can take it back to
   * null (`saveBlockSettings`).
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
   * still carry, untouched — normalization is additive).
   *
   * `null` is NOT YET RECORDED: nobody who has stood at the bed has said. A
   * record from before this field, every seeded bed and a bed the admin adds
   * all start here, because the old dates never said what a guard is made of
   * and a tag may ride a guard the record knows nothing about. The public
   * screen omits the guard entirely while unset rather than asserting a fact
   * nobody entered; the admin panel shows it as not set until the admin picks.
   */
  guard: GuardMaterial | null;
  // The rest of the bed's own profile, with `guard` above — what a passer-by
  // reading "About this bed" is told, because every bed is different (the
  // captain: "every tree is specialized"). The four facts are the admin page's
  // three-way radios; the three notes are admin-typed free text, rendered AS
  // TYPED in both languages (a plant list is not translated), each its own leaf
  // on the screen and bounded by `MAX_BED_NOTE_CHARS` (service.ts) like every
  // other typed field.
  /**
   * Whether a tree currently stands in this bed — stumps and empty pits are
   * real states. Three-way like `guard`: `null` is NOT YET RECORDED, which is
   * what every seeded bed and every backfilled row starts at. A checkbox
   * cannot tell "unchecked" from "not sent", so this is a radio group at the
   * panel and its absence from a POST keeps the fact as it stands rather than
   * publishing "no tree" for a bed nobody has looked at.
   */
  treePresent: boolean | null;
  /**
   * Whether anything is planted in the bed besides the tree.
   *
   * `null` is NOT YET RECORDED, exactly like `guard`: a public screen states
   * what somebody entered, never a default, so every seeded bed, every
   * backfilled row and every bed the admin adds starts here rather than at
   * `false` — which would tell a whole block's worth of visitors "nothing
   * planted yet" before anyone had stood at the bed.
   */
  plantsPresent: boolean | null;
  /**
   * What is planted — admin-typed, shown as typed, and shown ONLY while
   * `plantsPresent` is on (never while it is unrecorded). The note is kept in
   * the record whichever way the switch stands, so flipping it off and back on
   * restores the words; the switch decides whether the public screen states
   * them.
   */
  plantsNote: string;
  /**
   * Whether Trash Talk recommends planting in this bed. `null` is NOT YET
   * RECORDED, like `plantsPresent` and `guard`: the About page omits the row
   * entirely rather than publishing a recommendation nobody made.
   */
  plantingRecommended: boolean | null;
  /**
   * What to plant — admin-typed, shown as typed, and shown ONLY while
   * `plantingRecommended` is on; kept in the record either way, like
   * `plantsNote`, so the switch never costs the words.
   */
  recommendedPlantsNote: string;
  /** The care this bed needs right now — admin-typed, shown as typed. */
  careNote: string;
  /**
   * When this bed's stewards were last emailed about applause, or null before
   * the first such mail. Bookkeeping for the one-notification-per-bed-per-NY-day
   * bound (`sendApplause`): the CLAIM is written before the send, the same
   * claim-then-send shape `User.digestLastSentAt` uses, so a crash between the
   * two costs one day's notice rather than doubling it.
   */
  applauseNoticeAt: string | null;
  /**
   * Set when a counted applause has claimed the day but the mail has not gone
   * out yet, and cleared by the scheduled run that delivers it
   * (`runApplauseNotices` in digest.ts).
   *
   * The notice is QUEUED rather than sent from the press, because the press is
   * somebody standing at a tree: a Brevo call in front of their redirect puts
   * the transport's timeout and retry between them and the thank-you takeover.
   * `applauseNoticeAt` beside it is still what bounds the notice to one per
   * bed per NY day; this only says one is owed.
   */
  applauseNoticeDueAt: string | null;
  /**
   * Set when the captain deletes this bed on the admin page.
   *
   * Deleting is retiring, never erasing: the plate is the join key every
   * report, adoption and event hangs on, and the checked-in seed
   * (`ensureCheckedInBlocks`) re-inserts a missing seeded bed on every load —
   * so a removed ROW would both orphan its history and quietly resurrect.
   * A retired bed keeps every row keyed to its plate, drops out of the admin
   * lists, and stops resolving from a tap: a tag still bound to it renders the
   * calm "not assigned to a bed yet" screen (service.ts treats a retired bed
   * as not found). The plate is never reused — `nextPlate` still sees the row.
   */
  retiredAt: string | null;
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
   * Whether this person can sign in at all.
   *
   * Sign-in is passwordless — an emailed single-use link (`service.ts`,
   * `requestSignInLink`) — so this is true exactly for a steward with an
   * email on record, pen-and-paper stewards the admin entered with one
   * included. False only for a steward with no email: somebody who agreed on
   * the sidewalk and gave none, which the sidewalk case requires us to allow
   * (design-record.md, answered open question 3). `normalizeData` re-derives
   * it from the email on every load, so a record written under the retired
   * PIN scheme reads correctly without a migration.
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
  /**
   * The language this steward's screens spoke when they adopted (the
   * `tg_lang` cookie at that moment), and the language every email to them is
   * written in. A preference, not an identity, so it defaults to English
   * rather than refusing anything.
   */
  lang: Lang;
  /**
   * One-click unsubscribe pressed (`/digest/unsubscribe`): no digest reaches
   * this steward while true, whatever the network cadence says. Per-user
   * because the cadence itself is a network setting (`NetworkSettings`).
   */
  digestOptedOut: boolean;
  /**
   * When this steward's last digest was claimed for sending, or null before
   * the first. The claim is written before the send (`runDigest`), so a crash
   * between the two costs one period's digest rather than sending it twice.
   */
  digestLastSentAt: string | null;
  /** Rendered from stored values; earning rules are out of MVP scope. */
  points: number;
  /**
   * Weekly photo streak, in weeks — history from when the steward screen
   * asked for a weekly photo. Nothing renders or writes it since that ask
   * was removed; kept stored because this removes an ask from a screen, not
   * a steward's record.
   */
  streakWeeks: number;
  createdAt: string;
}

/**
 * How often the steward digest goes out. One setting for the whole network —
 * the captain has not picked a frequency yet ("x frequency, i havent decided
 * yet"), so it is a stored setting rather than a constant, edited on the
 * admin index. It DEFAULTS TO `off` by his explicit instruction ("do not
 * send anything"): nothing mails anybody until he turns it on there. `off`
 * holds every send without touching any per-user state.
 */
export type DigestCadence = 'off' | 'weekly' | 'biweekly' | 'monthly';

export const DIGEST_CADENCES: readonly DigestCadence[] = ['off', 'weekly', 'biweekly', 'monthly'];

/** Network-wide settings the block admin edits. Stored in the dataset. */
export interface NetworkSettings {
  digestCadence: DigestCadence;
}

/**
 * One outstanding tap-to-sign-in link (spec: passwordless, adopt-name-split-r5).
 *
 * The RAW token — 32 random bytes, base64url — exists only inside the emailed
 * link: what the store holds is its SHA-256, so a copy of the dataset (a
 * Blobs revision, a local store file) is never a bag of live sign-in links.
 * Single use: verifying deletes the row. Bound to the bed whose auth screen
 * minted it as well as to the user, so a link cannot be replayed against a
 * different tag's sign-in URL.
 */
export interface SignInToken {
  /** SHA-256 of the raw token, hex. Never the token itself. */
  tokenHash: string;
  userId: string;
  /** The bed whose auth screen the link was requested from. */
  bedPlate: string;
  createdAt: string;
  /** Minutes out (`SIGNIN_TOKEN_TTL_MS`); expired rows are pruned as new ones are minted. */
  expiresAt: string;
}

/**
 * One sign-in link request, kept only long enough to rate-limit the next one.
 *
 * In the store rather than in memory because function instances scale
 * horizontally — a per-process counter would be a separate allowance per
 * instance. The email is stored as a keyed hash (`hashSignInEmail`), never
 * raw: most requests name addresses that adopted nothing, and a rate-limit
 * ledger must not become a checkable list of typed-in emails.
 */
export interface SignInRequest {
  /** HMAC-SHA-256 of the lowercased email, hex (`hashSignInEmail`). */
  emailHash: string;
  bedPlate: string;
  requestedAt: string;
  /**
   * Whether the address resolved to a steward who can be mailed — i.e. whether
   * this request actually sent something. A row is appended either way, so the
   * answer a caller sees is identical for both; only the per-bed cap filters on
   * it (`MAX_SIGNIN_REQUESTS_PER_BED`).
   */
  resolved: boolean;
}

/**
 * How many requests one bed's auth screen has taken in the current window that
 * resolved to nobody — one row per bed, rewritten in place.
 *
 * It exists because the per-bed send cap counts only requests that resolved
 * (`MAX_SIGNIN_REQUESTS_PER_BED`), which leaves the misses bounded per address
 * but not per bed: a script cycling fresh addresses trips no cap and every one
 * of its requests is a full commit on the Blobs backend. This counter is what
 * bounds those writes (`MAX_SIGNIN_MISSES_PER_BED`), and it is a counter rather
 * than the ledger's own rows so what gates the writes can never be the thing
 * the writes grow.
 *
 * A tumbling window, not a sliding one: `windowStart` is when counting began
 * and the row is started afresh once it is a whole `SIGNIN_RATE_WINDOW_MS` old.
 */
export interface SignInMissWindow {
  bedPlate: string;
  /** ISO instant the current window began. */
  windowStart: string;
  count: number;
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
  /**
   * Whether anyone attached a photo to this report — the first reporter or a
   * confirming neighbour. The photos themselves are stored separately
   * (`ReportPhoto`, joined by `reportId`), so this flag can be true with no
   * stored photo behind it: a photo past the per-report cap is discarded, an
   * admin can delete one, and reports from before storage existed recorded
   * only the fact of attachment.
   */
  photoAttached: boolean;
}

/**
 * One stored care photo — the record half; the bytes live outside the dataset
 * (`PhotoBlobs` in store.ts), keyed by this row's `id`, because the dataset is
 * re-serialized whole on every commit and a photo is megabytes.
 *
 * Keyed to its report (`reportId`), never to a time window, the same exact
 * join the `confirm` events use — and kept when the report closes: the photos
 * are the report's history, and the ONLY removal path is the admin's explicit
 * delete (`deleteReportPhotoByAdmin`), which exists because holding pictures
 * the public uploads means being able to take one down.
 *
 * Admin-only, like the report's reporter id: no public screen or payload may
 * carry a stored photo or its URL.
 */
export interface ReportPhoto {
  /** `photo-<uuid>` — the row's key AND the blob's key. Server-minted, never typed. */
  id: string;
  bedPlate: string;
  reportId: string;
  /** Who attached it — a user id or an anonymous visitor id. Never rendered. */
  actorId: string;
  /**
   * The stored content type, already narrowed to a known image type or
   * `application/octet-stream` (`storedPhotoContentType`) — what the admin
   * serving route answers with, so a hand-built upload can never make that
   * route serve scriptable HTML or SVG under an admin origin.
   */
  contentType: string;
  /** Size of the stored blob, for the admin surface. */
  bytes: number;
  uploadedAt: string;
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
  // A steward renaming the bed from their own view (`renameBedBySteward`):
  // the trail of who changed the name and when. The chosen name rides in
  // `note`, so what it was changed TO is on the record beside who and when.
  | 'rename'
  // Written while the steward screen asked for a weekly photo; the ask is
  // gone but events are append-only, so stored rows still carry the kind.
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
   * `applause`, `adopt`, `release`, `rename`, `photo` — are not about a
   * report and are null.
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

/**
 * How a steward is named on a public screen: `@MapleSteward42`, the generated
 * shape every steward has had since 2026-09-11. The seeded `@marisol_r` keeps
 * the older shape — nothing rewrites a handle already on the street.
 */
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
 * unset" is not a state anything can hold. `Bed.guard` is additionally
 * nullable — null is "not yet recorded", which is a different thing from
 * "none" and is never one of these.
 */
export const GUARD_MATERIALS = ['none', 'wood', 'metal'] as const;
export type GuardMaterial = (typeof GUARD_MATERIALS)[number];

/**
 * The radio value the panel's own NOT RECORDED choice submits.
 *
 * An absent radio cannot mean "take this fact back": the panel always draws
 * the three-way rows, so a form that carries no radio at all is a hand-built
 * POST or a stale page, and either is kept as it stands. Unrecording is an
 * act the captain performs, so it travels as a value of its own.
 */
export const UNRECORDED_CHOICE = 'unset';

/**
 * Narrow a form value to the guard's three-way choice: a material, null for
 * the panel's NOT RECORDED choice, and undefined for anything else — a form
 * that carried no radio, which keeps the guard as it stands.
 */
export function guardMaterialFrom(value: unknown): GuardMaterial | null | undefined {
  if (value === UNRECORDED_CHOICE) return null;
  return (GUARD_MATERIALS as readonly unknown[]).includes(value)
    ? (value as GuardMaterial)
    : undefined;
}

/**
 * Narrow a form value to one of the profile's three-way facts (`treePresent`,
 * `plantsPresent`, `plantingRecommended`), exactly like the guard above: 'yes' or 'no', null for
 * the NOT RECORDED choice — the same value NOT YET RECORDED has on the record,
 * so it means the same thing at both ends — and undefined for anything else,
 * which keeps the fact as it stands.
 */
export function bedFactFrom(value: unknown): boolean | null | undefined {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  if (value === UNRECORDED_CHOICE) return null;
  return undefined;
}

/** Admin-only. Never render this on a public screen. */
export function fullName(user: User): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
}
