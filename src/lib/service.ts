// Server-side rules (spec §7).
//
// Every rule here MUST stay server-side — anything in the browser is editable
// in devtools. This layer is storage-agnostic: it only talks to the narrow
// Store interface, so swapping the persistence backend never touches a rule.

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Store } from './store';
import type {
  Adoption,
  Bed,
  BedEvent,
  Block,
  GuardMaterial,
  Report,
  Severity,
  SignInMissWindow,
  SignInToken,
  User,
} from './types';
import type { Lang } from './i18n';
import type { ProblemCategory } from './problem';
import { MAX_NOTE_CHARS, problemsFrom } from './problem';
import { nyCalendarDay } from './format';
import { signingSecret } from './signing-secret';
import { GENERIC_TREE, spanishSpeciesFor, tableSpeciesCasingFor } from './tree-species';
import { capped } from './typed-text';

export class RuleError extends Error {
  constructor(
    /** Stable machine-readable code the routes branch on. */
    public readonly code:
      | 'bed-not-found'
      | 'block-not-found'
      | 'open-report-exists'
      | 'already-reported-today'
      | 'no-open-report'
      | 'already-dumping'
      | 'slots-full'
      | 'invalid-input'
      | 'slot-out-of-range'
      | 'rate-limited'
      | 'invalid-token',
    message: string,
  ) {
    super(message);
  }
}

/** Everything the tap-flow screens need about one bed, in one read. */
export interface BedView {
  bed: Bed;
  /** Active stewards, oldest first. The word is "steward", not "adopter". */
  stewards: Array<{ adoption: Adoption; user: User }>;
  /**
   * Slots a visitor may actually take, which is the same bound `adoptBed`
   * refuses on: the physical slots AND the ones the captain has offered on
   * the admin page. Anything else invites somebody to fill in a form the
   * rules must then refuse, and explains it with a reason that isn't true.
   */
  openSlots: number;
  openReport: Report | null;
}

/**
 * The stewards a PUBLIC screen may engrave.
 *
 * `Adoption.displayNameHidden` is a person asking not to have their name on a
 * screen bolted to a sidewalk, so it is read here rather than at each screen:
 * one predicate, in the rules layer, that every public render goes through.
 *
 * Whether a bed reads as stewarded is deliberately NOT this list's length —
 * it is the adoption count. A bed whose only steward is hidden is still taken,
 * and door 1 inviting a stranger to adopt it would be the worse mistake.
 * The steward's own view (`mine.astro`) applies its own rule: hiding is about
 * the public screen, not about hiding a bed from the person tending it.
 */
export function engravedStewards(stewards: BedView['stewards']): BedView['stewards'] {
  return stewards.filter(({ adoption }) => !adoption.displayNameHidden);
}

/**
 * The bed as everything but the delete flow may act on it: an existing,
 * unretired row, or null.
 *
 * Retiring (`retireBedByAdmin`) keeps the row and every record keyed to its
 * plate, so the store still answers for the plate — this is the one predicate
 * that turns that tombstone into "not found" for every screen and rule, which
 * is what makes a tag still bound to a deleted bed degrade to the calm
 * "not assigned" screen instead of filing reports against a bed the admin
 * cannot see.
 */
export async function getActiveBed(store: Store, plate: string): Promise<Bed | null> {
  const bed = await store.getBed(plate);
  return bed !== null && bed.retiredAt === null ? bed : null;
}

export async function getBedView(store: Store, plate: string): Promise<BedView | null> {
  const bed = await getActiveBed(store, plate);
  if (!bed) return null;
  const adoptions = await store.getActiveAdoptions(plate);
  const stewards = [];
  for (const adoption of adoptions) {
    const user = await store.getUser(adoption.userId);
    if (user) stewards.push({ adoption, user });
  }
  return {
    bed,
    stewards,
    openSlots: Math.max(0, Math.min(bed.slots, bed.offeredSlots) - stewards.length),
    openReport: (await store.getOpenReport(plate)) ?? null,
  };
}

/**
 * Every plain tap on the tag is an append-only event (spec §4). It goes
 * through the same committed path as every other write, so a tap is never
 * left sitting in memory that some other request's rollback can discard.
 */
export async function logTap(
  store: Store,
  args: { plate: string; actorId: string; now?: Date },
): Promise<void> {
  await store.transaction(async (tx) => {
    await appendEvent(tx, args.plate, 'tap', args.actorId, null, args.now);
  });
}

/** Rule (spec §2): one report per person per bed per calendar day (America/New_York). */
export async function hasReportedToday(
  store: Store,
  plate: string,
  actorId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const reports = await store.getReports(plate);
  const today = nyCalendarDay(now);
  return reports.some(
    (r) => r.reporterId === actorId && nyCalendarDay(new Date(r.openedAt)) === today,
  );
}

/**
 * What one press of SEND IT on the care screen did.
 *
 * The approved flow has one screen after it — the "Thank you" takeover — and
 * no receipt, no confirm button and no rate-limited screen. So the rules do not
 * refuse a visitor here; they decide what the press is worth and the screen
 * says thank you either way. Which one happened is still reported, because the
 * admin surface and the events are where this has to be legible.
 */
export type ProblemOutcome =
  /** Nothing was open: this opened a report. */
  | { kind: 'filed'; report: Report }
  /** Somebody had already reported it: this added weight to that report. */
  | { kind: 'added-weight'; report: Report }
  /** This person has already had their say on this bed today. */
  | { kind: 'already-said'; report: Report | null };

export interface ProblemInput {
  plate: string;
  actorId: string;
  /** Every tile the visitor pressed — the picker is multi-select. */
  categories: ProblemCategory[];
  note: string;
  photoAttached: boolean;
  now?: Date;
}

/**
 * "This bed needs care", filed.
 *
 * One transaction covering both halves, because they are one decision: two
 * simultaneous tappers must not both pass the single-open-report check and
 * leave a second report nobody can ever close — `closeReport` only ever finds
 * the first.
 *
 * The three rules from spec §2/§7 are unchanged, only their answers are:
 *  - a bed carries at most one open report. A later reporter used to be sent to
 *    a "confirm it" screen; the approved flow has no such screen, so the same
 *    press adds their weight to the open report instead. Same record, same
 *    bound (`MAX_CONFIRMATIONS`), one less screen between a neighbour and being
 *    counted — and what they picked and typed rides on the `confirm` event,
 *    because the screen thanks them for telling us either way.
 *  - one report per person per bed per NY calendar day. A second press the same
 *    day writes nothing at all rather than showing somebody a rule.
 *  - the note is capped server-side; the browser's counter is a courtesy.
 */
export async function reportProblem(store: Store, args: ProblemInput): Promise<ProblemOutcome> {
  const { plate, actorId, photoAttached } = args;
  // Re-derived here rather than trusted: the route already parses, but this
  // rule is server-side like every other, and a caller is free to hand it
  // duplicates or values naming no tile (spec §7).
  const categories = problemsFrom(args.categories);
  if (categories.length === 0) {
    throw new RuleError('invalid-input', 'A report names at least one problem');
  }
  const note = capped(args.note, MAX_NOTE_CHARS);
  const now = args.now ?? new Date();
  return store.transaction(async (tx) => {
    const bed = await getActiveBed(tx, plate);
    if (!bed) throw new RuleError('bed-not-found', `No bed with plate ${plate}`);

    const open = await tx.getOpenReport(plate);
    if (open) {
      // Already theirs, or the array is at its bound: either way the press
      // costs nothing more and the screen says the same thing.
      if (open.reporterId === actorId || open.confirmedBy.includes(actorId)) {
        return { kind: 'already-said', report: open };
      }
      if (open.confirmedBy.length >= MAX_CONFIRMATIONS) {
        return { kind: 'already-said', report: open };
      }
      // Their categories and their sentence ride on the `confirm` event: the
      // report already belongs to the first reporter, but what the second
      // neighbour said has to reach the steward rather than be thanked for and
      // dropped. The photo flag moves onto the report, because it is true of
      // the bed's open problem that somebody attached one.
      // No new growth concern: the note is capped at `MAX_NOTE_CHARS` above,
      // the categories are bounded by the four tiles, and the confirmations
      // this rides alongside are bounded by `MAX_CONFIRMATIONS`, so both the
      // array and the events it adds stop.
      const weighted: Report = {
        ...open,
        confirmedBy: [...open.confirmedBy, actorId],
        photoAttached: open.photoAttached || photoAttached,
      };
      await tx.updateReport(weighted);
      await appendEvent(tx, plate, 'confirm', actorId, null, now, {
        categories,
        note,
        reportId: open.id,
      });
      return { kind: 'added-weight', report: weighted };
    }

    if (await hasReportedToday(tx, plate, actorId, now)) {
      return { kind: 'already-said', report: null };
    }

    const number = await tx.nextReportNumber();
    // Report id keys off the plate's numeric suffix, e.g. RPT-2217-0847.
    const suffix = plate.split('-').at(-1) ?? '0000';
    const report: Report = {
      id: `RPT-${number}-${suffix}`,
      bedPlate: plate,
      reporterId: actorId,
      categories,
      note,
      // Nothing on the street sets this: the approved problem screen asks what
      // is wrong, not how bad. Escalation is what writes it (`escalateReport`).
      severity: null,
      openedAt: now.toISOString(),
      closedAt: null,
      closedBy: null,
      escalatedFrom: null,
      confirmedBy: [],
      photoAttached,
    };
    await tx.createReport(report);
    await appendEvent(tx, plate, 'report', actorId, null, now, {
      categories,
      note,
      reportId: report.id,
    });
    return { kind: 'filed', report };
  });
}

/**
 * "SEND APPLAUSE" — the one thing a passer-by can do for a bed that is fine.
 *
 * Bounded to once per person per bed per NY calendar day, for the reason every
 * other write here is bounded: `events` is append-only with nothing pruning it,
 * and a button anybody can press without signing in is otherwise unbounded
 * growth keyed to whoever is holding the phone. The route gates it further, on
 * a cookie the caller already had (`getExistingActorId`), which a neighbour
 * standing at the tree always has.
 *
 * Returns whether this press was the one that counted, so the screen can be
 * honest without being a rule notice.
 */
export async function sendApplause(
  store: Store,
  args: { plate: string; actorId: string; now?: Date },
): Promise<{ counted: boolean }> {
  const now = args.now ?? new Date();
  return store.transaction(async (tx) => {
    const bed = await getActiveBed(tx, args.plate);
    if (!bed) throw new RuleError('bed-not-found', `No bed with plate ${args.plate}`);
    const today = nyCalendarDay(now);
    const already = (await tx.getEvents(args.plate, 'applause')).some(
      (e) => e.actorId === args.actorId && nyCalendarDay(new Date(e.createdAt)) === today,
    );
    if (already) return { counted: false };
    await appendEvent(tx, args.plate, 'applause', args.actorId, null, now);
    return { counted: true };
  });
}

/**
 * How many confirmations one report keeps.
 *
 * The per-person rule bounds honest use — a block has nothing like this many
 * neighbours — so the cap only ever binds on a caller working around it with a
 * fresh identity each time. Bounding the stored array bounds what it costs:
 * the row rewritten on every write, the event appended beside it, and the
 * number rendered on a public screen.
 */
export const MAX_CONFIRMATIONS = 200;

/** Raise the open report to dumping. Anyone may escalate; only upward, only once. */
export async function escalateReport(
  store: Store,
  args: { plate: string; actorId: string; now?: Date },
): Promise<Report> {
  return store.transaction(async (tx) => {
    const open = await tx.getOpenReport(args.plate);
    if (!open) throw new RuleError('no-open-report', `No open report on ${args.plate}`);
    if (open.severity === 'dumping') {
      throw new RuleError('already-dumping', `Report ${open.id} is already at dumping`);
    }
    const raised: Report = { ...open, escalatedFrom: open.severity, severity: 'dumping' };
    await tx.updateReport(raised);
    await appendEvent(tx, args.plate, 'escalate', args.actorId, 'dumping', args.now, {
      reportId: open.id,
    });
    return raised;
  });
}

/**
 * Closes whoever's report is open. Actor-agnostic, as spec §2 asks — anyone can
 * mark clear, and stale reports otherwise read as steward neglect.
 *
 * Who may reach it is the route's business, and `/clear` currently admits only
 * a signed-in steward of the bed; see AGENTS.md for why, and for what re-opening
 * it to everyone needs first.
 */
export async function closeReport(
  store: Store,
  args: { plate: string; actorId: string; now?: Date },
): Promise<Report> {
  const now = args.now ?? new Date();
  return store.transaction(async (tx) => {
    const open = await tx.getOpenReport(args.plate);
    if (!open) throw new RuleError('no-open-report', `No open report on ${args.plate}`);
    const closed: Report = { ...open, closedAt: now.toISOString(), closedBy: args.actorId };
    await tx.updateReport(closed);
    await appendEvent(tx, args.plate, 'clear', args.actorId, null, now, { reportId: open.id });
    return closed;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s().-]{6,19}$/;

/**
 * The same shape check the adopt form applies, for the sign-in screen: a
 * string that cannot be an address should cost a validation message, not a
 * slot in the rate-limit window.
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/**
 * What a typed field may put into a record the store then carries forever.
 *
 * `MAX_FORM_BYTES` bounds the request, not the field, so without these one
 * paste can leave ~64KB inside a name, an address or a tree type — re-uploaded
 * whole on every commit (`BlobsStore` writes the entire dataset per tap) and
 * rendered into every page that prints it. Trimmed to the bound rather than
 * refused, the same way a care note is (`MAX_NOTE_CHARS`): the screens carry
 * the matching `maxlength`, so a person typing never reaches this at all.
 */
export const MAX_NAME_CHARS = 60;
/** RFC 5321's own ceiling on an address. */
export const MAX_EMAIL_CHARS = 254;
export const MAX_ADDRESS_CHARS = 120;
export const MAX_TREE_TYPE_CHARS = 60;
/**
 * The bed's given name is engraved on the door screens beside the bed's
 * identity, so it is held shorter than a person's name fields: long enough
 * for "La Madrina de la 171" and short enough that one line stays one line.
 */
export const MAX_BED_NAME_CHARS = 40;
/**
 * The bed profile's three notes — what is planted, what to plant, what care
 * is needed. Admin-typed, but rendered as leaves on a PUBLIC screen ("About
 * this bed"), so they are bounded the same way every visitor-typed field is:
 * long enough for a sentence, short enough that the screen stays a screen.
 */
export const MAX_BED_NOTE_CHARS = 160;

/**
 * What the approved adopt form collects, and nothing more.
 *
 * **No secret.** The captain chose passwordless and ordered the PIN/password
 * field dropped, for three reasons this build must not undo: a forgotten
 * secret is permanent lockout with no recovery path; a cloned plaque on a
 * public repo gives an attacker a reusable secret to harvest; and a short
 * numeric code on a street object has no brute-force protection. The screen is
 * drawn without one and is built without one.
 *
 * No username either. Public identity is still `@handle` — it is derived from
 * the name (`deriveUsername`), the way the seeded steward's `@marisol_r` is
 * derived from Marisol Rivera.
 *
 * What carries a steward from here is the year-long session cookie set at
 * adoption; the way back in after losing it is the emailed single-use link
 * (`requestSignInLink`), keyed to the email this form collects.
 */
export interface AdoptInput {
  firstName: string;
  lastName: string;
  email: string;
  /**
   * Optional, by the captain's own note on the approved screens ("Phone is
   * required today — you asked for phone to be optional. Right now the form
   * refuses to submit without one, which costs signups on a sidewalk").
   * Validated only when given.
   */
  phone: string;
  /**
   * The name the FIRST steward gives the bed ("the first adopter names the
   * bed" — the captain's own reading). Optional, never required: absent and
   * empty both mean "no name given", and the bed simply has none. The form
   * only offers the field to the first steward; `adoptBed` re-decides
   * eligibility inside the transaction, so a hand-built or raced submission
   * from anyone else is silently ignored rather than refused — nobody
   * standing at a tree is shown a rule.
   */
  bedName?: string;
}

export type AdoptField = keyof AdoptInput;

/**
 * Why a field was refused, as a KEY rather than a sentence.
 *
 * The rules layer must not hold English: every screen renders in the visitor's
 * language, and a message returned from here would be the one string on the
 * form that could not be Spanish. The keys match `ADOPT_ERRORS` in copy.ts, so
 * a rule without a translation is a type error.
 */
export type AdoptErrorCode = 'firstName' | 'lastName' | 'email' | 'phone';

export type AdoptErrors = Partial<Record<AdoptField, AdoptErrorCode>>;

/**
 * The normalized form of `AdoptInput`: every field present, `bedName` an empty
 * string where none was given, so no caller downstream repeats the fallback.
 */
export type AdoptValues = AdoptInput & { bedName: string };

/** Field-level validation; returns normalized values and error codes. */
export function validateAdoptInput(raw: AdoptInput): { values: AdoptValues; errors: AdoptErrors } {
  const values: AdoptValues = {
    firstName: capped(raw.firstName, MAX_NAME_CHARS),
    lastName: capped(raw.lastName, MAX_NAME_CHARS),
    email: capped(raw.email, MAX_EMAIL_CHARS),
    phone: raw.phone.trim(),
    // Optional and free-form: bounded, never refused — a name is whatever
    // its first steward says it is, up to the cap.
    bedName: capped(raw.bedName ?? '', MAX_BED_NAME_CHARS),
  };
  const errors: AdoptErrors = {};
  if (values.firstName.length < 1) errors.firstName = 'firstName';
  if (values.lastName.length < 1) errors.lastName = 'lastName';
  if (!EMAIL_RE.test(values.email)) errors.email = 'email';
  // Given or not given; wrong only if it is there and malformed.
  if (values.phone !== '' && !PHONE_RE.test(values.phone)) errors.phone = 'phone';
  return { values, errors };
}

/**
 * The two things about stored state an adoption needs to be true: a bed that
 * exists, and a slot free on it.
 *
 * There is no username leg any more — nobody submits one, so there is nothing
 * to collide and nothing to answer about. That also closes the enumeration
 * oracle this used to have to price carefully: a public route that would say
 * "that handle is taken" is a free directory of everyone on the network, and
 * the form no longer has a question to ask it with.
 */
async function checkAdoptPreconditions(store: Store, plate: string): Promise<void> {
  const bed = await getActiveBed(store, plate);
  if (!bed) throw new RuleError('bed-not-found', `No bed with plate ${plate}`);

  const active = await store.getActiveAdoptions(plate);
  // Two bounds, one refusal: the physical slot count, and how many of those
  // the captain has actually OFFERED on the admin page (`Bed.offeredSlots`).
  // A bed with a slot built but not offered refuses exactly like a full one —
  // the admin switch is a rule here, not a display state, because anything
  // enforced only by a screen is editable in devtools (spec §7). No bound tag
  // points at an unoffered bed today, so no approved screen changes meaning.
  if (active.length >= Math.min(bed.slots, bed.offeredSlots)) {
    throw new RuleError('slots-full', `${plate} has no offered slot open`);
  }
}

/** Trim to the handle alphabet: lowercase, ASCII letters/digits/underscore. */
function handleSafe(part: string): string {
  return part
    .normalize('NFD')
    // Strip the combining marks NFD just separated out, so José becomes jose
    // rather than jos — a third of this block's names carry one.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The public handle, derived from the name rather than typed.
 *
 * The approved form collects a first and last name and nothing else, and the
 * seeded steward shows the shape the captain has been looking at all along:
 * Marisol Rivera → `@marisol_r`, printed above `M. R.`. So the handle is the
 * first name and the last initial, which is exactly as much as the initials
 * underneath it already give away.
 *
 * `taken` decides collisions rather than a store read, so the caller can run
 * this inside the transaction that will write the user — two people with the
 * same name adopting at once must not both be handed `@marisol_r`.
 */
export function deriveUsername(
  firstName: string,
  lastName: string,
  taken: (candidate: string) => boolean,
): string {
  const first = handleSafe(firstName).slice(0, 20);
  const initial = handleSafe(lastName).slice(0, 1);
  // A name with nothing in the handle alphabet at all still needs a handle.
  const base = first === '' ? 'steward' : initial === '' ? first : `${first}_${initial}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}${n}`;
    if (!taken(candidate)) return candidate;
  }
}

/** The slot cap (spec §7) enforced here, server-side: `min(slots, offeredSlots)`. */
export async function adoptBed(
  store: Store,
  args: {
    plate: string;
    input: AdoptInput;
    /**
     * The language the adopt screen spoke when the form was submitted (the
     * `tg_lang` resolution) — recorded on the user so every email to them,
     * the digest first, arrives in the language they adopted in.
     */
    lang?: Lang;
    now?: Date;
  },
): Promise<User> {
  const now = args.now ?? new Date();
  const { values, errors } = validateAdoptInput(args.input);
  if (Object.keys(errors).length > 0) {
    throw new RuleError('invalid-input', Object.values(errors).join(' '));
  }

  // Cheap reads first, as a pre-filter rather than the rule: a POST no slot
  // can receive should not reach the write queue at all. The authoritative
  // pass is inside the transaction below, so the race is unchanged and
  // `slots-full` is still what a full bed hears.
  //
  // Nothing here buys CPU: no secret is collected, so nothing is hashed, and
  // the only thing a flood can buy is the bed's offered slots — once they
  // are taken every further POST refuses on three reads.
  await checkAdoptPreconditions(store, args.plate);

  // Exclusive: the slot count and the handle are only worth anything if nobody
  // can claim the last slot, or the same handle, in between.
  return store.transaction(async (tx) => {
    await checkAdoptPreconditions(tx, args.plate);

    const activeBefore = await tx.getActiveAdoptions(args.plate);

    // Resolved inside the transaction, against the users it will commit
    // alongside: two neighbours with the same name adopting at the same moment
    // must not both be handed the same handle.
    const existing = new Set<string>();
    for (const other of activeBefore) {
      const user = await tx.getUser(other.userId);
      if (user) existing.add(user.username.toLowerCase());
    }
    const username = await (async () => {
      let candidate = deriveUsername(values.firstName, values.lastName, (c) => existing.has(c));
      // The set above only covers this bed; the store is the authority for
      // every other one, and the walk is bounded by how many people share a
      // name on one network.
      while (await tx.getUserByUsername(candidate)) {
        existing.add(candidate);
        candidate = deriveUsername(values.firstName, values.lastName, (c) => existing.has(c));
      }
      return candidate;
    })();

    const user: User = {
      id: `user-${randomUUID()}`,
      firstName: values.firstName,
      lastName: values.lastName,
      username,
      // Passwordless, by the captain's decision: no secret is collected, and
      // the way back in is the emailed single-use link (`requestSignInLink`).
      // The adopt form requires an email, so everyone created here can sign
      // in. Distinct from the pen-and-paper case: this person signed
      // themselves up, so nobody is holding the record on their behalf
      // (design-record.md, answered open question 3).
      hasSignInRoute: true,
      recordHeldOnBehalf: false,
      email: values.email,
      phone: values.phone,
      lang: args.lang ?? 'en',
      digestOptedOut: false,
      digestLastSentAt: null,
      points: 0,
      streakWeeks: 0,
      createdAt: now.toISOString(),
    };
    await tx.createUser(user);
    await tx.createAdoption({
      id: `adoption-${randomUUID()}`,
      bedPlate: args.plate,
      userId: user.id,
      adoptedAt: now.toISOString(),
      stewardKind: 'nfc',
      displayNameHidden: false,
      releasedAt: null,
    });
    // "The first adopter names the bed" — and from then on it is the bed's
    // name, not theirs. Decided HERE, against the adoptions as the transaction
    // sees them, so the form's own offer (rendered before the POST) cannot be
    // raced into a rename: anyone but the first active steward of a still
    // unnamed bed has their `bedName` silently dropped — the adoption itself
    // goes through, and nobody at a tree is shown a rule. A cleared name
    // (`saveBlockSettings`) puts the bed back to unnamed, so a later first
    // steward may name it again; an existing name is never overwritten.
    if (values.bedName !== '' && activeBefore.length === 0) {
      const bed = await tx.getBed(args.plate);
      if (bed && bed.bedName === null) {
        await tx.updateBed({ ...bed, bedName: values.bedName });
      }
    }
    await appendEvent(tx, args.plate, 'adopt', user.id, null, now);
    return user;
  });
}

// ── Sign-in by emailed link ─────────────────────────────────────────────
//
// Passwordless, by the captain's standing decision (adopt-name-split-r5): the
// steward enters the email they adopted with and receives a short-lived,
// single-use link. No secret is ever invented, stored, or emailed — what the
// store holds is a SHA-256 of the token, so a copy of the dataset is never a
// bag of live sign-in links, and the raw token exists only inside the mail.
// A LINK rather than a typed code, deliberately: a code is relay-phishable
// through a cloned plaque page, while the link resolves against our own
// domain. Sign-in stays rare because the session cookie already lasts a year.

/** How long an emailed link works. Minutes, per the captain's decision. */
export const SIGNIN_TOKEN_TTL_MS = 15 * 60 * 1000;

/** The sliding window the two request caps below are counted over. */
export const SIGNIN_RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Link requests one email may make per window. Three covers a flaky inbox
 * and a mistyped tap; what it bounds is a stranger pointing mail at somebody
 * else's address all afternoon. Counted in the store, not in memory, because
 * function instances scale horizontally and a per-process counter would be a
 * separate allowance per instance.
 */
export const MAX_SIGNIN_REQUESTS_PER_EMAIL = 3;

/**
 * Link requests one bed's auth screen may take per window, counted across
 * every email but only over requests that RESOLVED to a mailable steward. The
 * per-email cap resets with each fresh address, so without a per-bed cap a
 * script cycling addresses would buy unbounded sends (and store growth) from
 * one tag URL.
 *
 * Only resolved requests count because the availability side of the trade is
 * the more expensive one: a tag URL is printed on a public street object, so if
 * misses counted, a passer-by could spend the whole window on twelve made-up
 * addresses and lock every real steward of that bed out of signing in — over
 * and over, for free. A miss sends no mail, so it costs nothing this cap
 * exists to bound; what bounds the misses themselves is the per-email cap plus
 * the row pruning, and the per-IP limiting still owed at the platform tier
 * (request-body.ts).
 *
 * A row is appended for a miss all the same, so the write pattern — and
 * therefore the answer and its timing — cannot tell the two kinds apart.
 */
export const MAX_SIGNIN_REQUESTS_PER_BED = 12;

/**
 * Unresolved requests one bed's auth screen may WRITE per window
 * (`SignInMissWindow`), which is the bound the resolved-only cap above leaves
 * open: the per-email cap resets with every fresh address, so a script cycling
 * addresses trips neither cap, and on the Blobs backend each of its requests is
 * a whole-dataset re-serialization plus a revision with KEPT_REVISIONS copies
 * trailing it. Two hundred is far above what a street ever produces by mistake
 * and far below what makes the store's write path a lever.
 *
 * It bounds the WRITES rather than the answers: past the ceiling an unresolved
 * request still gets the same "check your inbox" an unresolved request always
 * got — it simply records nothing, so nothing a stranger can do to this screen
 * stops a real steward's link (the availability half of the trade above) or
 * grows the dataset.
 *
 * Residual, accepted: a request past the ceiling makes no commit and is
 * therefore measurably faster, so the ceiling is a timing signal for "this bed
 * has taken 200 misses this hour" — which is a fact about the bed, not about
 * any address, and so says nothing about who is on the network. It sits in the
 * same accepted tier as the mail call a resolved request makes, and the answer
 * itself stays byte-identical.
 */
export const MAX_SIGNIN_MISSES_PER_BED = 200;

/**
 * Domain separation for the ledger's MAC, the same way `unsubscribeMac` and
 * the session cookies label theirs: one construction's output over the shared
 * secret must never be usable as another's. Changing it re-keys the ledger,
 * which needs no migration for the reason above — the rows live one window.
 */
const SIGNIN_EMAIL_MAC_PURPOSE = 'signin-email:';

/**
 * The rate-limit ledger's key for an address: an HMAC-SHA-256 of the
 * lowercased email, hex, keyed by the server's signing secret.
 *
 * Keyed rather than a bare digest because a bare SHA-256 of an email is not
 * opaque — anyone holding a copy of the dataset can test any address they care
 * about, or run a dictionary, and the ledger is then a checkable list of who
 * typed something into a tree bed's sign-in screen, including people with no
 * record on the network at all. With the key, the rows are meaningless without
 * the secret and still compare exactly, which is all the caps need.
 *
 * The secret resolves through signing-secret.ts, the same no-`import.meta`
 * path unsubscribe-link.ts uses. Rotating it re-keys the ledger, which needs
 * no migration: the rows live one `SIGNIN_RATE_WINDOW_MS` and are deleted on
 * the way past, so a re-key costs at most one hour of unclaimed allowance.
 */
export function hashSignInEmail(email: string): string {
  return createHmac('sha256', signingSecret())
    .update(`${SIGNIN_EMAIL_MAC_PURPOSE}${email.trim().toLowerCase()}`)
    .digest('hex');
}

/** SHA-256 hex of the raw token — the only form the store ever sees. */
function hashSignInToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * What one press of the auth screen's button resolved to. The screen says
 * "check your inbox" for both kinds — whether an email is on the network is
 * not a public question — and only the mail plane is told the difference.
 */
export type SignInLinkOutcome =
  /** A steward's address: the token to put in the link, and who it signs in. */
  | { kind: 'sent'; token: string; user: User }
  /** Nobody's address. Nothing stored, nothing to send. */
  | { kind: 'unknown-email' };

/**
 * The ceiling's control signal. Not a `RuleError`: nothing about it reaches a
 * caller — it exists only to leave the transaction without committing, and
 * `requestSignInLink` turns it back into the ordinary unknown-email answer.
 */
class SignInMissCeiling extends Error {}

/** This bed's miss counter with this attempt added, starting a fresh window
 * once the stored one is a whole `SIGNIN_RATE_WINDOW_MS` old. */
function countedMiss(
  stored: SignInMissWindow | null,
  bedPlate: string,
  now: Date,
): SignInMissWindow {
  const current =
    stored !== null && now.getTime() - Date.parse(stored.windowStart) < SIGNIN_RATE_WINDOW_MS
      ? stored
      : { bedPlate, windowStart: now.toISOString(), count: 0 };
  return { bedPlate, windowStart: current.windowStart, count: current.count + 1 };
}

/**
 * "Email me a sign-in link", decided.
 *
 * One transaction: the rate-limit window slides, the caps are checked, the
 * request is recorded and the token minted against one dataset, so two
 * simultaneous requests cannot both pass a cap they jointly exceed.
 *
 * The refusal (`rate-limited`) is decided by the hashed ledger alone, before
 * the email is ever looked up, so a known and an unknown address are refused
 * — and admitted — identically. The request row is appended for both kinds
 * for the same reason: both paths make the same writes, so the response
 * cannot say which one ran. What the row RECORDS differs (`resolved`), and
 * only the per-bed cap reads it, so a stranger's misses cannot spend the
 * budget a real steward needs. What bounds the misses' own writes is the
 * per-bed miss ceiling (`MAX_SIGNIN_MISSES_PER_BED`), which changes what is
 * recorded and never what is answered. What still differs is the mail call the
 * route makes for a real steward, a residual timing signal noted on the route.
 *
 * The raw token is returned to the caller for the one journey it exists for
 * — into the emailed link — and is never stored or logged anywhere.
 */
export async function requestSignInLink(
  store: Store,
  args: { plate: string; email: string; now?: Date },
): Promise<SignInLinkOutcome> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const email = args.email.trim().slice(0, MAX_EMAIL_CHARS);
  const emailHash = hashSignInEmail(email);
  try {
    return await runSignInLinkRequest(store, { ...args, now, nowIso, email, emailHash });
  } catch (err) {
    // The ceiling is not a refusal: an unresolved address has always been
    // answered "check your inbox" with nothing sent, and that must not change
    // just because this bed has taken a lot of misses this hour.
    if (err instanceof SignInMissCeiling) return { kind: 'unknown-email' };
    throw err;
  }
}

/** The transaction `requestSignInLink` runs, split out only so the ceiling's
 * control signal can be caught outside it — throwing is what keeps the
 * over-ceiling attempt from committing. */
async function runSignInLinkRequest(
  store: Store,
  args: { plate: string; email: string; emailHash: string; now: Date; nowIso: string },
): Promise<SignInLinkOutcome> {
  const { now, nowIso, email, emailHash } = args;
  return store.transaction(async (tx) => {
    const windowStart = new Date(now.getTime() - SIGNIN_RATE_WINDOW_MS).toISOString();
    // Housekeeping on the way past, in the same commit: the ledger holds one
    // window's rows and the token table holds only live links, so neither
    // grows with lifetime traffic the way `events` deliberately does.
    await tx.deleteSignInRequestsBefore(windowStart);
    await tx.deleteSignInTokensExpiredBy(nowIso);
    const recent = await tx.getSignInRequestsSince(windowStart);
    if (
      recent.filter((r) => r.emailHash === emailHash).length >= MAX_SIGNIN_REQUESTS_PER_EMAIL ||
      recent.filter((r) => r.bedPlate === args.plate && r.resolved).length >=
        MAX_SIGNIN_REQUESTS_PER_BED
    ) {
      // Refused attempts are deliberately NOT recorded: recording them would
      // let a stranger hold somebody's address at the cap forever with a
      // request a minute, where this way the cap only ever counts sends.
      throw new RuleError('rate-limited', 'Too many sign-in link requests');
    }
    // The lookup happens before the row is written so the row can record which
    // kind this was — but under the miss ceiling BOTH kinds write exactly one
    // row, so nothing about the sequence of store calls differs between them.
    const user = await tx.getUserByEmail(email);
    const resolved = user !== null && user.hasSignInRoute;
    if (!resolved) {
      // Past the ceiling this request writes nothing at all — which has to
      // mean leaving the transaction by throwing, because a commit happens on
      // the way out of the callback whether or not it wrote anything, and a
      // commit is the cost being bounded. The sentinel is caught below and
      // answered exactly as any unresolved address is.
      const counted = countedMiss(await tx.getSignInMissWindow(args.plate), args.plate, now);
      if (counted.count > MAX_SIGNIN_MISSES_PER_BED) throw new SignInMissCeiling();
      await tx.putSignInMissWindow(counted);
    }
    await tx.appendSignInRequest({ emailHash, bedPlate: args.plate, requestedAt: nowIso, resolved });
    if (!resolved || !user) return { kind: 'unknown-email' };
    const token = randomBytes(32).toString('base64url');
    await tx.createSignInToken({
      tokenHash: hashSignInToken(token),
      userId: user.id,
      bedPlate: args.plate,
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + SIGNIN_TOKEN_TTL_MS).toISOString(),
    });
    return { kind: 'sent', token, user };
  });
}

/**
 * The emailed link, opened: verify the token, burn it, hand back the steward
 * it signs in. Every failure is the same `invalid-token` — an expired link, a
 * used one, and one that never existed must read identically, or the answer
 * becomes an oracle for which tokens were real.
 *
 * Single use is the delete: the row goes before the user is returned, inside
 * the transaction, so two taps on the same link race for one delete and only
 * the first signs in. A token opened at a different bed's URL is refused
 * WITHOUT being burned — the mismatch is a wrong door, not a spent link, and
 * whoever holds the token is its rightful recipient, so the real link they
 * were sent must keep working.
 *
 * The lookup compares hashes with ordinary string equality on purpose: the
 * stored value is a SHA-256 of a 256-bit random token, so a timing signal
 * could only ever confirm a hash the caller already computed — nothing about
 * an unknown token leaks through it.
 */
export async function consumeSignInToken(
  store: Store,
  args: { plate: string; token: string; now?: Date },
): Promise<User> {
  const now = args.now ?? new Date();
  const tokenHash = hashSignInToken(args.token);
  return store.transaction(async (tx) => {
    const record = await tx.getSignInToken(tokenHash);
    if (!record) throw new RuleError('invalid-token', 'No such sign-in link');
    if (record.bedPlate !== args.plate) {
      throw new RuleError('invalid-token', 'Sign-in link opened at a different bed');
    }
    if (record.expiresAt <= now.toISOString()) {
      // No delete here on purpose: the transaction rolls back on this throw,
      // so a delete would never persist anyway. The expired row is reclaimed
      // by `deleteSignInTokensExpiredBy` on the next mint.
      throw new RuleError('invalid-token', 'Sign-in link expired');
    }
    await tx.deleteSignInToken(tokenHash);
    const user = await tx.getUser(record.userId);
    if (!user) throw new RuleError('invalid-token', 'Sign-in link names no user');
    return user;
  });
}

/** Exposed for the suites that need to place a token's row directly. */
export function signInTokenRecord(args: {
  token: string;
  userId: string;
  bedPlate: string;
  now: Date;
}): SignInToken {
  return {
    tokenHash: hashSignInToken(args.token),
    userId: args.userId,
    bedPlate: args.bedPlate,
    createdAt: args.now.toISOString(),
    expiresAt: new Date(args.now.getTime() + SIGNIN_TOKEN_TTL_MS).toISOString(),
  };
}

// ── The block admin's rules ─────────────────────────────────────────────
//
// Server-side like every other rule, and behind the admin session at the
// route (src/pages/admin/). Everything below reads and writes through the
// `tx` of one transaction wherever it checks state before writing it, for
// the same reason the visitor rules do.

/**
 * How many slots a bed may grow to. "+ ADD SLOT" is the deliberate act that
 * takes a bed past its default (design-record.md, constraint 10; spec §2's
 * "a third slot can open later"), and this is its ceiling — a bound, so a
 * held-down button cannot grow a record without limit.
 */
export const MAX_BED_SLOTS = 4;

/** One bed, with everything the admin page shows about it. */
export interface AdminBedView {
  bed: Bed;
  /** Active stewards, oldest first — the admin list is the click-through to contact details. */
  stewards: Array<{ adoption: Adoption; user: User }>;
  /**
   * The bed's one open report, read-only: the admin panel states what was
   * picked, the note, when it was opened and how many neighbours added their
   * weight. Closing it stays the steward's act on `mine.astro` (`/clear`).
   *
   * Resolved for the ONE bed the caller names (`openReportFor`) and null on
   * every other, because only the opened bed's panel states it: a read per
   * bed for a record the page discards grows with the block.
   */
  openReport: Report | null;
  /**
   * What the neighbours who added their weight to that open report said —
   * their categories and their sentence, which ride on the `confirm` events
   * because a second neighbour writes nothing else (`reportProblem`).
   *
   * The steward already reads these on `mine.astro`, and the public FAQ tells
   * a visitor that Trash Talk NYC sees the report: the captain's own surface
   * must not see less of one than the steward does. Joined by the event's own
   * `reportId`, never a time window — `report → clear → report` is a supported
   * loop — and bounded by `MAX_CONFIRMATIONS` like the confirmations
   * themselves. Empty on every bed but the one the caller named.
   */
  openReportConfirms: Array<{ categories: ProblemCategory[]; note: string }>;
}

/** The block and its beds, in block order. */
export interface BlockView {
  block: Block;
  beds: AdminBedView[];
  /**
   * The block's deleted beds, kept apart from the live ones.
   *
   * A delete is a retirement (`retireBedByAdmin`), and the page that can undo
   * it is the one that did it — so the rows are handed over separately rather
   * than mixed into `beds`, where every control assumes a live bed. Stewards
   * are deliberately not read for them: the only affordance a retired row has
   * is RESTORE.
   */
  retired: Bed[];
}

/**
 * What the neighbours who added their weight to an open report said.
 *
 * The report belongs to whoever filed it, so a confirming neighbour's own
 * categories and sentence ride on their `confirm` event (`reportProblem`).
 * The join is the event's own `reportId`, NEVER a time window:
 * `report → clear → report` is a supported loop and only the id says which
 * lap an event belongs to; events written before that field carry null and
 * match nothing, which shows no neighbour rather than the wrong one.
 * Bounded by `MAX_CONFIRMATIONS`, like the confirmations themselves.
 *
 * One helper rather than one per screen: the steward's own view and the
 * captain's panel must not drift on what a report says, because the panel
 * exists so the captain never sees less of one than the steward does.
 */
export async function getOpenReportConfirms(
  store: Store,
  plate: string,
  openReport: Report | null,
): Promise<Array<{ categories: ProblemCategory[]; note: string }>> {
  if (!openReport) return [];
  return (await store.getEvents(plate, 'confirm'))
    .filter((e) => e.reportId === openReport.id && (e.categories.length > 0 || e.note !== ''))
    .reverse()
    .map((e) => ({ categories: e.categories, note: e.note }));
}

/**
 * The block admin page's read.
 *
 * `openReportFor` is the plate of the bed the page has open, and the only one
 * whose open report is read: the panel is the single place a report is stated,
 * so resolving one per bed would cost a store read per bed for a record
 * nothing renders.
 */
export async function getBlockView(
  store: Store,
  blockId: string,
  openReportFor: string | null = null,
): Promise<BlockView | null> {
  const block = await store.getBlock(blockId);
  if (!block) return null;
  const beds: AdminBedView[] = [];
  const retired: Bed[] = [];
  // A deleted bed is retired, not erased (`retireBedByAdmin`): the row and its
  // history stay in the store, and this split is what takes it off the street
  // list while still leaving the captain a way back from a mis-tap.
  for (const bed of await store.getBedsInBlock(blockId)) {
    if (bed.retiredAt !== null) {
      retired.push(bed);
      continue;
    }
    const adoptions = await store.getActiveAdoptions(bed.plate);
    const stewards = [];
    for (const adoption of adoptions) {
      const user = await store.getUser(adoption.userId);
      if (user) stewards.push({ adoption, user });
    }
    const openReport =
      bed.plate === openReportFor ? ((await store.getOpenReport(bed.plate)) ?? null) : null;
    const openReportConfirms = await getOpenReportConfirms(store, bed.plate, openReport);
    beds.push({ bed, stewards, openReport, openReportConfirms });
  }
  return { block, beds, retired };
}

/** What one press of SAVE CHANGES on the block admin page carries. */
export interface BlockSaveInput {
  blockId: string;
  /** The typed reference address (constraint 10). Blank keeps what stands. */
  referenceAddress: string;
  /** The opened bed's controls, when a bed was open. */
  bed?: {
    plate: string;
    /**
     * The guard standing at the bed — the panel's three-way choice, never a
     * flag plus a material: 'none', or a guard and what it is made of. Null
     * is the panel's own NOT RECORDED choice, which takes the fact back to
     * not-yet-recorded — a mis-tap on a street must be undoable, so absence
     * of a radio is not what unrecords. Undefined is a form that carried no
     * radio at all, which keeps the guard exactly as it stands.
     */
    guard: GuardMaterial | null | undefined;
    /**
     * The bed profile's three-way facts — what "About this bed" states — all
     * read like `guard`: true, false, null for the NOT RECORDED choice that
     * takes the fact back, and undefined for a form that carried no radio,
     * which keeps it as it stands. One rule covers the whole profile: a field
     * the form did not carry is never blanked.
     */
    treePresent: boolean | null | undefined;
    plantsPresent: boolean | null | undefined;
    plantingRecommended: boolean | null | undefined;
    /**
     * The profile's typed notes: what is planted, what to plant, what care
     * the bed needs right now. Rendered as typed on the public about screen,
     * so each goes through `capped` here like every other typed field —
     * and undefined is the same keep-as-it-stands the facts above get, so a
     * form with no textarea in it cannot blank the admin's words.
     */
    plantsNote: string | undefined;
    recommendedPlantsNote: string | undefined;
    careNote: string | undefined;
    /**
     * WHICH unfilled slots the captain left switched on, by slot number.
     *
     * The indices rather than a count, because `offeredSlots` is a count
     * covering slots 1..n: a selection that skips one cannot be stored, and
     * storing its size instead re-renders a different switch than the one
     * that was flipped. Carrying the indices is what lets the save refuse
     * that selection and say so, rather than silently re-mapping it.
     */
    offeredSlotNumbers: number[];
    /**
     * How many slots past the bed's stored count the page in front of the
     * captain was drawing, up to MAX_BED_SLOTS.
     *
     * A count rather than a flag because "+ ADD SLOT" is page-local: the
     * press only redraws the panel, and each press adds to what the last one
     * drew rather than replacing it. This save is where those slots are
     * finally written. Clamped, so a hand-built number buys nothing.
     */
    addSlots: number;
    /**
     * Take the bed's given name back to unnamed. The name is visitor-supplied
     * free text on a public screen bolted to a street, so the organisation
     * must be able to take one down without touching the bed or its adoption
     * — this switch is that, and the only rename path is a first steward
     * naming an unnamed bed again. Never re-typed here: the admin removes a
     * name, it does not author one.
     */
    clearBedName?: boolean;
  };
}

/**
 * The offered count a set of switched-on slot numbers means, or a refusal.
 *
 * `offeredSlots` covers slots 1..n, so the only selections it can hold are
 * the ones that run from the first unfilled slot without a gap. A gapped
 * selection is refused as `invalid-input` — the alternative is saving its
 * size, which re-renders switches the captain never touched.
 *
 * A number no switch on this bed carries is a different refusal
 * (`slot-out-of-range`) rather than the same one: telling somebody to put
 * their switches back in order when they already are explains nothing.
 *
 * Filled slots are always offered, whatever arrived: a steward adopting
 * between the render and the save can never be switched away.
 */
function offeredSlotCount(numbers: number[], filled: number, slots: number): number {
  const chosen = new Set<number>();
  for (const raw of numbers) {
    const n = Math.floor(raw);
    // Out of range: the render puts no switch there at all, so this is not a
    // state the page can produce.
    if (!Number.isFinite(n) || n < 1 || n > slots) {
      throw new RuleError('slot-out-of-range', `slot ${raw} is not switchable on this bed`);
    }
    // A slot filled between the render and this save arrives switched on,
    // because it was switchable when the page was drawn. It is offered by
    // definition, so it is absorbed rather than refusing the whole press.
    if (n <= filled) continue;
    chosen.add(n);
  }
  for (let n = filled + 1; n <= filled + chosen.size; n += 1) {
    if (!chosen.has(n)) {
      throw new RuleError('invalid-input', 'offered slots must run from the first open one');
    }
  }
  return filled + chosen.size;
}

/**
 * A profile note as submitted, or what stands when the form did not carry the
 * field at all — the same keep-as-it-stands the three-way facts get, so one
 * rule covers the whole profile and a partial POST blanks nothing.
 */
function keptNote(submitted: string | undefined, stored: string): string {
  return submitted === undefined ? stored : capped(submitted, MAX_BED_NOTE_CHARS);
}

/**
 * Save the block admin page: the reference address, and the opened bed's
 * profile (the guard and the three facts as three-way radios, plus the three
 * typed notes), slot switches, added slot and bed-name takedown.
 *
 * One transaction for the whole press: the offered count is computed against
 * the adoptions as they stand INSIDE it, so a steward adopting between render
 * and save can never be switched away — a filled slot always counts as
 * offered, and the count is clamped to what physically exists.
 *
 * One rule covers the whole profile: a field the form did not carry keeps what
 * stands — `undefined` rather than the NOT RECORDED choice's null, told apart
 * with `=== undefined` — so a partial POST blanks nothing.
 */
export async function saveBlockSettings(store: Store, args: BlockSaveInput): Promise<void> {
  await store.transaction(async (tx) => {
    const block = await tx.getBlock(args.blockId);
    // Distinct from the bed's refusal below: a block that does not exist is a
    // URL nobody should be at, while a bed that has gone is a stale tab the
    // captain is standing in front of. Two codes, so the route can answer the
    // second one with a screen instead of a line of unstyled English.
    if (!block) throw new RuleError('block-not-found', `No block ${args.blockId}`);
    // Every refusal is found BEFORE the first write, so a save either lands
    // whole or writes nothing at all. Updating the address first and meeting
    // a deleted bed after it rolled the address back too — the same outcome
    // as this, but reached by a rollback the route could not describe to the
    // captain, so it told them only half of what had happened.
    const wanted = args.bed ?? null;
    const bed = wanted ? await getActiveBed(tx, wanted.plate) : null;
    if (wanted && (!bed || bed.blockId !== args.blockId)) {
      throw new RuleError('bed-not-found', `No bed ${wanted.plate} in block ${args.blockId}`);
    }
    // The slot refusals are found here too, ahead of the address write, for
    // the same reason: the page that comes back says "unsaved changes", and
    // it must be telling the truth about the address as well as the switches.
    let pending: { slots: number; offeredSlots: number } | null = null;
    if (wanted && bed) {
      const added = Number.isFinite(wanted.addSlots) ? Math.max(0, Math.floor(wanted.addSlots)) : 0;
      const slots = Math.min(MAX_BED_SLOTS, bed.slots + added);
      const filled = (await tx.getActiveAdoptions(bed.plate)).length;
      pending = { slots, offeredSlots: offeredSlotCount(wanted.offeredSlotNumbers, filled, slots) };
    }

    const referenceAddress = capped(args.referenceAddress, MAX_ADDRESS_CHARS);
    if (referenceAddress !== '' && referenceAddress !== block.referenceAddress) {
      await tx.updateBlock({ ...block, referenceAddress });
    }
    if (!wanted || !bed || !pending) return;

    await tx.updateBed({
      ...bed,
      slots: pending.slots,
      offeredSlots: pending.offeredSlots,
      bedName: wanted.clearBedName ? null : bed.bedName,
      guard: wanted.guard === undefined ? bed.guard : wanted.guard,
      treePresent: wanted.treePresent === undefined ? bed.treePresent : wanted.treePresent,
      plantsPresent: wanted.plantsPresent === undefined ? bed.plantsPresent : wanted.plantsPresent,
      plantingRecommended:
        wanted.plantingRecommended === undefined
          ? bed.plantingRecommended
          : wanted.plantingRecommended,
      plantsNote: keptNote(wanted.plantsNote, bed.plantsNote),
      recommendedPlantsNote: keptNote(wanted.recommendedPlantsNote, bed.recommendedPlantsNote),
      careNote: keptNote(wanted.careNote, bed.careNote),
    });
  });
}

/**
 * What the admin's add-a-steward form collects. Email is OPTIONAL here — the
 * sidewalk case requires it (design-record.md, answered open question 3) —
 * where the visitor adopt form requires one. Username is typed or left blank
 * for the same derivation the adopt form uses.
 */
export interface AdminStewardInput {
  firstName: string;
  lastName: string;
  /** With or without the leading @; blank derives from the name. */
  username: string;
  email: string;
  phone: string;
}

export type AdminStewardErrors = Partial<
  Record<keyof AdminStewardInput, keyof AdminStewardInput>
>;

const USERNAME_RE = /^[a-z0-9_]{2,30}$/;

/** Field-level validation for the admin form; same shape as `validateAdoptInput`. */
export function validateAdminStewardInput(raw: AdminStewardInput): {
  values: AdminStewardInput;
  errors: AdminStewardErrors;
} {
  const values: AdminStewardInput = {
    firstName: capped(raw.firstName, MAX_NAME_CHARS),
    lastName: capped(raw.lastName, MAX_NAME_CHARS),
    // The handle's own bound is USERNAME_RE's 2–30, which refuses rather than
    // trims — a handle is engraved, so a silently shortened one is wrong.
    username: raw.username.trim().replace(/^@/, '').toLowerCase(),
    email: capped(raw.email, MAX_EMAIL_CHARS),
    phone: raw.phone.trim(),
  };
  const errors: AdminStewardErrors = {};
  if (values.firstName.length < 1) errors.firstName = 'firstName';
  if (values.lastName.length < 1) errors.lastName = 'lastName';
  if (values.username !== '' && !USERNAME_RE.test(values.username)) errors.username = 'username';
  // Optional, but wrong if present and malformed — a mistyped email is a
  // steward nobody can ever reach, silently.
  if (values.email !== '' && !EMAIL_RE.test(values.email)) errors.email = 'email';
  if (values.phone !== '' && !PHONE_RE.test(values.phone)) errors.phone = 'phone';
  return { values, errors };
}

/**
 * Write in a steward the captain signed up on the sidewalk.
 *
 * The record is created BY the team FOR the person, and says so:
 * `recordHeldOnBehalf: true`, no secret. Sign-in is the emailed link, so a
 * steward written in WITH an email can sign in like anyone else
 * (`hasSignInRoute`), and one written in without an email cannot — that
 * missing email is recorded as exactly that, never read as consent to be
 * contacted, and no other outreach is invented here (the pen-and-paper
 * contact route is its own later task).
 *
 * The captain may fill a slot the public switches have not offered — writing
 * a neighbour in is the act the page exists for — but never past the bed's
 * physical `slots`.
 */
export async function addStewardByAdmin(
  store: Store,
  args: {
    plate: string;
    input: AdminStewardInput;
    /**
     * The language the admin screen spoke when the steward was written in —
     * the best available guess at the language of the sidewalk conversation,
     * and what any email to this steward is written in.
     */
    lang?: Lang;
    now?: Date;
  },
): Promise<User> {
  const now = args.now ?? new Date();
  const { values, errors } = validateAdminStewardInput(args.input);
  if (Object.keys(errors).length > 0) {
    throw new RuleError('invalid-input', Object.values(errors).join(' '));
  }
  return store.transaction(async (tx) => {
    const bed = await getActiveBed(tx, args.plate);
    if (!bed) throw new RuleError('bed-not-found', `No bed with plate ${args.plate}`);
    const active = await tx.getActiveAdoptions(args.plate);
    if (active.length >= bed.slots) {
      throw new RuleError('slots-full', `${args.plate} already has ${bed.slots} stewards`);
    }

    let username = values.username;
    if (username === '') {
      // Same derivation, same in-transaction collision walk as `adoptBed`.
      const taken = new Set<string>();
      username = deriveUsername(values.firstName, values.lastName, (c) => taken.has(c));
      while (await tx.getUserByUsername(username)) {
        taken.add(username);
        username = deriveUsername(values.firstName, values.lastName, (c) => taken.has(c));
      }
    } else if (await tx.getUserByUsername(username)) {
      // A typed handle that collides is refused rather than mutated — the
      // captain typed it deliberately, and quietly issuing `dani_t2` would
      // engrave a handle nobody chose.
      throw new RuleError('invalid-input', 'username');
    }

    const user: User = {
      id: `user-${randomUUID()}`,
      firstName: values.firstName,
      lastName: values.lastName,
      username,
      // The emailed link is the only sign-in there is, so an email on the
      // form is a sign-in route and a blank one is none.
      hasSignInRoute: values.email !== '',
      recordHeldOnBehalf: true,
      email: values.email,
      phone: values.phone,
      lang: args.lang ?? 'en',
      digestOptedOut: false,
      digestLastSentAt: null,
      points: 0,
      streakWeeks: 0,
      createdAt: now.toISOString(),
    };
    await tx.createUser(user);
    await tx.createAdoption({
      id: `adoption-${randomUUID()}`,
      bedPlate: args.plate,
      userId: user.id,
      adoptedAt: now.toISOString(),
      stewardKind: 'pen-and-paper',
      displayNameHidden: false,
      releasedAt: null,
    });
    await appendEvent(tx, args.plate, 'adopt', user.id, null, now);
    return user;
  });
}

/**
 * "+ ADD A BED" on the block admin page.
 *
 * The new bed starts the way the six seeded ones did: one slot, nothing
 * offered, the guard not yet recorded, no tag — and NO NYC identifiers. A planting space ID is
 * resolved against NYC's own data or left null, never typed free-hand and
 * never generated: a fabricated identifier is indistinguishable from a real
 * one and wrong in a way nobody can see. The admin page prints the unresolved
 * state instead.
 */
export async function addBedByAdmin(
  store: Store,
  args: { blockId: string; treeType: { en: string; es: string }; now?: Date },
): Promise<Bed> {
  const en = capped(args.treeType.en, MAX_TREE_TYPE_CHARS);
  // The Spanish name resolves in this order: what the admin typed (the table
  // is a default, never a lock), then the checked-in species table, then the
  // generic "árbol" — the same wording `normalizeData` gives a bed with no
  // tree type at all. Never the English name and never a guess: the word
  // renders inside a Spanish sentence on the neighbour's own street, where a
  // wrong or English species name is worse than a generic one
  // (tree-species.ts).
  const typedEs = capped(args.treeType.es, MAX_TREE_TYPE_CHARS);
  // A typed name that is the table's own modulo casing is the table's, so it
  // is stored the way the door frame needs it; anything else is a name and
  // keeps every character the admin typed.
  const es = typedEs
    ? (tableSpeciesCasingFor(en, typedEs) ?? typedEs)
    : (spanishSpeciesFor(en) ?? GENERIC_TREE.es);
  if (en === '') throw new RuleError('invalid-input', 'treeType');
  return store.transaction(async (tx) => {
    const block = await tx.getBlock(args.blockId);
    if (!block) throw new RuleError('block-not-found', `No block ${args.blockId}`);
    // Retired siblings deliberately count: the plate series and the positions
    // continue past a deleted bed rather than reusing what it held.
    const siblings = await tx.getBedsInBlock(args.blockId);
    const position = Math.max(0, ...siblings.map((b) => b.blockPosition ?? 0)) + 1;
    const bed: Bed = {
      plate: await nextPlate(tx, siblings),
      plantingSpaceId: null,
      plantingSpaceGlobalId: null,
      treeType: { en, es },
      treeId: '',
      bedName: null,
      tagUid: '',
      crossStreets: siblings[0]?.crossStreets ?? '',
      address: block.referenceAddress,
      slots: 1,
      offeredSlots: 0,
      guard: null,
      treePresent: null,
      plantsPresent: null,
      plantsNote: '',
      plantingRecommended: null,
      recommendedPlantsNote: '',
      careNote: '',
      blockId: args.blockId,
      blockPosition: position,
      nycSyncedAt: null,
      nycMissingSince: null,
      retiredAt: null,
    };
    await tx.createBed(bed);
    return bed;
  });
}

/**
 * "DELETE THIS BED" on the block admin page, confirmed.
 *
 * Deleting is RETIRING: the row stays, `retiredAt` is set, and everything
 * keyed to the plate — adoptions, reports, events — is left exactly where it
 * is. Erasing the row was rejected twice over: the plate is the join key that
 * history hangs on, and the checked-in seed (`ensureCheckedInBlocks`) would
 * re-insert a deleted seeded bed on its next load, so only a tombstone
 * actually stays deleted. What retirement changes is visibility: the bed
 * drops out of every admin list (`getBlockView`) and every rule and screen
 * answers "not found" for its plate (`getActiveBed`), so a tag still bound to
 * it renders the calm "not assigned" screen. The plate is never reused —
 * `nextPlate` still walks past the row.
 *
 * Idempotent: a bed already retired stays retired at its original date, so a
 * resubmitted confirmation costs nothing and still lands on the block page.
 */
export async function retireBedByAdmin(
  store: Store,
  args: { blockId: string; plate: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await store.transaction(async (tx) => {
    const bed = await tx.getBed(args.plate);
    if (!bed || bed.blockId !== args.blockId) {
      throw new RuleError('bed-not-found', `No bed ${args.plate} in block ${args.blockId}`);
    }
    if (bed.retiredAt !== null) return;
    await tx.updateBed({ ...bed, retiredAt: now.toISOString() });
  });
}

/**
 * The way back from a mis-tapped delete.
 *
 * Retirement is a single nullable field and nothing keyed to the plate was
 * touched, so undoing it is clearing the field — guard dates, offered slots,
 * stewards, reports and events all come back exactly as they were, and the
 * tag still bound to the bed resolves again on the next tap with no deploy.
 * That matters because the tag→site registry is checked in (tag-bindings.ts)
 * and has no runtime write path: without this, a mis-tap on the live pilot
 * would cost that tag its screen until somebody shipped a commit.
 *
 * Mirrors `retireBedByAdmin`: the bed must exist in the block it is being
 * restored on, and restoring a bed that is not retired is a no-op.
 */
export async function restoreBedByAdmin(
  store: Store,
  args: { blockId: string; plate: string },
): Promise<void> {
  await store.transaction(async (tx) => {
    const bed = await tx.getBed(args.plate);
    if (!bed || bed.blockId !== args.blockId) {
      throw new RuleError('bed-not-found', `No bed ${args.plate} in block ${args.blockId}`);
    }
    if (bed.retiredAt === null) return;
    await tx.updateBed({ ...bed, retiredAt: null });
  });
}

/**
 * The next plate in a block's own sequence: the siblings' prefix with the
 * next number, walked past any plate that exists anywhere — plates are the
 * global join key, so a collision outside the block still counts.
 */
async function nextPlate(store: Store, siblings: Bed[]): Promise<string> {
  const prefix = siblings[0]?.plate.replace(/-\d+$/, '') ?? 'BED-NEW';
  // The suffix keeps the siblings' own width, so a block's plates stay one
  // series: BED-HRL-0847 is followed by BED-HRL-0848, not BED-HRL-848.
  const width = Math.max(1, ...siblings.map((b) => (/(\d+)$/.exec(b.plate)?.[1] ?? '').length));
  const suffix = (n: number): string => String(n).padStart(width, '0');
  let n = Math.max(0, ...siblings.map((b) => Number(/(\d+)$/.exec(b.plate)?.[1] ?? 0))) + 1;
  while (await store.getBed(`${prefix}-${suffix(n)}`)) n += 1;
  return `${prefix}-${suffix(n)}`;
}

async function appendEvent(
  store: Store,
  bedPlate: string,
  eventType: BedEvent['eventType'],
  actorId: string | null,
  severity: Severity | null,
  now?: Date,
  said?: { categories?: ProblemCategory[]; note?: string; reportId: string },
): Promise<void> {
  await store.appendEvent({
    id: `event-${randomUUID()}`,
    bedPlate,
    eventType,
    severity,
    categories: said?.categories ?? [],
    note: said?.note ?? '',
    reportId: said?.reportId ?? null,
    actorId,
    createdAt: (now ?? new Date()).toISOString(),
  });
}
