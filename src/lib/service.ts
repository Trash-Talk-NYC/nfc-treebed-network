// Server-side rules (spec §7).
//
// Every rule here MUST stay server-side — anything in the browser is editable
// in devtools. This layer is storage-agnostic: it only talks to the narrow
// Store interface, so swapping the persistence backend never touches a rule.

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { boundFromEnv } from './bounds';
import type { Store } from './store';
import type { Adoption, Bed, BedEvent, Block, Report, Severity, User } from './types';
import type { ProblemCategory } from './problem';
import { MAX_NOTE_CHARS, problemsFrom } from './problem';
import { nyCalendarDay } from './format';

export class RuleError extends Error {
  constructor(
    /** Stable machine-readable code the routes branch on. */
    public readonly code:
      | 'bed-not-found'
      | 'open-report-exists'
      | 'already-reported-today'
      | 'no-open-report'
      | 'already-dumping'
      | 'slots-full'
      | 'invalid-credentials'
      | 'invalid-input'
      | 'slot-out-of-range'
      | 'busy',
    message: string,
  ) {
    super(message);
  }
}

const PIN_ROUNDS = 10;

// bcrypt costs ~150–300ms of CPU by design, and bcryptjs is pure JS on the one
// thread that serves every tap. The async variants yield to the event loop once
// per `MAX_EXECUTION_TIME` (100ms) of synchronous work — not per round — so
// they keep a hash from blocking the loop for its whole duration; they do not
// make it cheap. `MAX_INFLIGHT_PIN_HASHES` below is what bounds how many of
// these run at once, which matters most on sign-in, the one un-rate-limited
// path (AGENTS.md).
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_ROUNDS);
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  return bcrypt.compare(pin, pinHash);
}

/**
 * How many PIN hashes may be running at once.
 *
 * `request-body.ts` bounds the bytes, the time and the concurrency of every
 * public POST, but a body it admits costs nothing to serve until a rule turns
 * it into work — and a bcrypt is ~150–300ms of the one thread that also serves
 * every tap. `/auth` is public and unauthenticated, and a read's share of
 * `MAX_INFLIGHT_BODY_BYTES` is released before the rule runs, so without this
 * nothing at all queues the hashing: a few dozen POSTs a second to `/auth`
 * saturate the loop and every tap, report and applause stalls behind them.
 *
 * `/adopt` used to be the other one. It no longer hashes anything — the
 * captain's passwordless decision means the form collects no secret — so the
 * only work a flood can buy there is the bed's offered slots, at a few reads
 * each.
 *
 * It sheds rather than queues, the same way an over-budget body does: waiting
 * in line for a saturated CPU is the stall, not the cure.
 *
 * What it guarantees is bounded backlog, not bounded CPU. bcryptjs yields once
 * per 100ms of synchronous work, so four admitted hashes keep the thread in
 * bcrypt nearly continuously; what the bound removes is the queue behind them.
 * A tap arriving mid-flood waits behind at most `MAX_INFLIGHT_PIN_HASHES`
 * hashes — a few hundred milliseconds — instead of behind however many the
 * flood managed to start. The plaque, the report and the confirm stay usable
 * under load; they do not stay fast.
 *
 * The other side of that trade is that a sustained flood holds `/auth` at its
 * busy screen for as long as it lasts. That is deliberate: auth loses to the
 * street action. Per-IP limiting at the platform tier is the
 * eventual remedy, alongside the per-PIN rate limiting that is still absent and
 * still owed before any real rollout (AGENTS.md) — this bounds the cost of
 * attempts, not their number.
 *
 * The counter is module state, so all of that describes one process: the whole
 * server on the node target, one function instance on netlify, where fleet-wide
 * bcrypt concurrency is this number times however many instances are running
 * and one warm instance serving concurrent invocations sheds legitimate
 * sign-ins at the same limit. See the same note in request-body.ts.
 *
 * `TREEBED_MAX_INFLIGHT_PIN_HASHES` exists so the end-to-end suite can watch a
 * real client be shed without racing a bcrypt; it is a test seam, like the two
 * in request-body.ts, not a deployment knob. Zero is legal because that is the
 * value the suite drives the shed path with, and it disables sign-in outright
 * — which is why it is announced twice, by `scripts/preflight.mjs` and by
 * `warnIfPinHashingDisabled` below.
 */
export const MAX_INFLIGHT_PIN_HASHES = boundFromEnv('TREEBED_MAX_INFLIGHT_PIN_HASHES', 4);

/**
 * Called from `src/middleware.ts`, so a bound that disables auth is said on the
 * first request of any route rather than on the first one that happens to load
 * a chunk importing this file — which at module scope here could be several
 * screens into a session. `scripts/preflight.mjs` says it before the port is
 * bound; the adapter imports both this file and the middleware lazily, so
 * nothing in the app itself can speak at process start.
 */
export function warnIfPinHashingDisabled(): void {
  if (MAX_INFLIGHT_PIN_HASHES >= 1) return;
  console.warn(
    `[service] TREEBED_MAX_INFLIGHT_PIN_HASHES=${MAX_INFLIGHT_PIN_HASHES}: sign-in is disabled, every attempt answers busy`,
  );
}

let inflightPinHashes = 0;

/** At most one shed line per window, so the flood can't write the log. */
const SHED_LOG_INTERVAL_MS = 60_000;
let shedSinceLastLog = 0;
let lastShedLogAt = 0;

/**
 * The only server-side trace of a CPU flood: the node adapter writes no access
 * log, so without this the 503s are invisible from the box. One line per
 * minute carrying the count, never one per request — an anonymous caller must
 * not decide how much stderr the shed path costs, on the path whose whole
 * point is being the cheap answer.
 */
function noteShedPinHash(): void {
  shedSinceLastLog += 1;
  const now = Date.now();
  if (lastShedLogAt !== 0 && now - lastShedLogAt < SHED_LOG_INTERVAL_MS) return;
  console.warn(
    `[service] PIN hash shed at the ${MAX_INFLIGHT_PIN_HASHES}-hash bound (${shedSinceLastLog} since the last line)`,
  );
  lastShedLogAt = now;
  shedSinceLastLog = 0;
}

async function withPinHashSlot<T>(work: () => Promise<T>): Promise<T> {
  if (inflightPinHashes >= MAX_INFLIGHT_PIN_HASHES) {
    noteShedPinHash();
    throw new RuleError('busy', `More than ${MAX_INFLIGHT_PIN_HASHES} PIN hashes already running`);
  }
  inflightPinHashes += 1;
  try {
    return await work();
  } finally {
    inflightPinHashes -= 1;
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

export async function getBedView(store: Store, plate: string): Promise<BedView | null> {
  const bed = await store.getBed(plate);
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
  const note = args.note.slice(0, MAX_NOTE_CHARS);
  const now = args.now ?? new Date();
  return store.transaction(async (tx) => {
    const bed = await tx.getBed(plate);
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
    const bed = await tx.getBed(args.plate);
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
 * Control characters and the bidirectional-format overrides, which a hand-built
 * POST can carry into a field the browser's own input would never produce.
 * Every typed field lands on a screen as a leaf beside copy of ours, and an
 * embedded newline or a U+202E can visually scramble the text around it.
 */
const UNRENDERABLE_RE = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/** Strip what cannot be rendered, trim, then bound: what every typed field goes through before it is stored. */
function capped(raw: string, max: number): string {
  return raw.replace(UNRENDERABLE_RE, '').trim().slice(0, max);
}

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
 * adoption. The tap-to-sign-in link that replaces the PIN screens belongs to
 * `adopt-name-split-r5` and needs the org's Brevo account; until it lands, a
 * steward who clears cookies has no way back in. That gap is stated in the PR
 * rather than papered over with a secret the captain removed.
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
  const bed = await store.getBed(plate);
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
  args: { plate: string; input: AdoptInput; now?: Date },
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
  // Nothing here buys CPU any more. Adoption used to cost a bcrypt, which is
  // what `MAX_INFLIGHT_PIN_HASHES` was bounding on this route; with no secret
  // to hash, the only thing a flood can buy is the two slots, and once they
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
      // Passwordless, by the captain's decision: no secret is collected, so
      // there is none to store.
      pinHash: null,
      // No way to authenticate TODAY — the tap-to-sign-in link that gives them
      // one is `adopt-name-split-r5`. What carries them until then is the
      // year-long session cookie the route sets on the way to the takeover.
      // Distinct from the pen-and-paper case below it: this person signed
      // themselves up and gave an email, so nobody is holding the record on
      // their behalf (design-record.md, answered open question 3).
      hasSignInRoute: false,
      recordHeldOnBehalf: false,
      email: values.email,
      phone: values.phone,
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

let unmatchableHash: Promise<string> | null = null;

/**
 * A hash of a value no submitted PIN can equal, so an unknown username costs
 * the same bcrypt compare as a known one. Built on first use rather than at
 * import so startup doesn't pay for it; the promise is cached so simultaneous
 * misses share the one hash.
 */
function unmatchablePinHash(): Promise<string> {
  unmatchableHash ??= hashPin(`no-such-pin-${randomUUID()}`);
  return unmatchableHash;
}

export async function signIn(
  store: Store,
  args: { username: string; pin: string },
): Promise<User> {
  // Admission is taken before the lookup, not around the compare: whether a
  // request is shed must not depend on whether the username exists, or the
  // constant-time compare below would leak through the refusal instead.
  return withPinHashSlot(async () => {
    const user = await store.getUserByUsername(args.username.trim().replace(/^@/, ''));
    // Same error AND the same timing for unknown user and wrong PIN — a short
    // circuit here would make username enumeration free, since sign-in attempts
    // are not yet rate limited (AGENTS.md).
    // A steward with no sign-in route (pen-and-paper) has no hash to compare,
    // so they get the unmatchable one — the same bcrypt, the same answer, and
    // no way to tell "no such person" from "cannot sign in" by timing it.
    const pinMatches = await verifyPin(
      args.pin,
      (user?.hasSignInRoute ? user.pinHash : null) ?? (await unmatchablePinHash()),
    );
    if (!user || !pinMatches) {
      throw new RuleError('invalid-credentials', 'Username and PIN don’t match.');
    }
    return user;
  });
}

/**
 * Log this week's photo, at most once per NY week — the rule lives here, not
 * in the route, so the check and the append can't be raced by a double tap.
 * Storage and point earning are out of MVP scope; only the event is kept.
 */
export async function logPhoto(
  store: Store,
  args: { plate: string; actorId: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await store.transaction(async (tx) => {
    if (await hasPhotoThisWeek(tx, args.plate, args.actorId, now)) return;
    await appendEvent(tx, args.plate, 'photo', args.actorId, null, now);
  });
}

/** Has this user logged a photo for this bed in the current NY ISO week? */
export async function hasPhotoThisWeek(
  store: Store,
  plate: string,
  actorId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const photos = await store.getEvents(plate, 'photo');
  const week = nyIsoWeek(now);
  return photos.some((e) => e.actorId === actorId && nyIsoWeek(new Date(e.createdAt)) === week);
}

function nyIsoWeek(date: Date): string {
  // Week bucketing only needs to be stable, not ISO-8601-perfect: key on the
  // Monday of the week in NY time.
  const day = nyCalendarDay(date); // YYYY-MM-DD
  const d = new Date(`${day}T00:00:00Z`);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
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
}

/** The block admin page's read: the block and its beds, in block order. */
export interface BlockView {
  block: Block;
  beds: AdminBedView[];
}

export async function getBlockView(store: Store, blockId: string): Promise<BlockView | null> {
  const block = await store.getBlock(blockId);
  if (!block) return null;
  const beds: AdminBedView[] = [];
  for (const bed of await store.getBedsInBlock(blockId)) {
    const adoptions = await store.getActiveAdoptions(bed.plate);
    const stewards = [];
    for (const adoption of adoptions) {
      const user = await store.getUser(adoption.userId);
      if (user) stewards.push({ adoption, user });
    }
    beds.push({ bed, stewards });
  }
  return { block, beds };
}

/** What one press of SAVE CHANGES on the block admin page carries. */
export interface BlockSaveInput {
  blockId: string;
  /** The typed reference address (constraint 10). Blank keeps what stands. */
  referenceAddress: string;
  /** The opened bed's controls, when a bed was open. */
  bed?: {
    plate: string;
    guardInstalled: boolean;
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
  now?: Date;
}

/**
 * Save the block admin page: the reference address, and the opened bed's
 * guard toggle, slot switches and added slot.
 *
 * One transaction for the whole press: the offered count is computed against
 * the adoptions as they stand INSIDE it, so a steward adopting between render
 * and save can never be switched away — a filled slot always counts as
 * offered, and the count is clamped to what physically exists.
 */
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

export async function saveBlockSettings(store: Store, args: BlockSaveInput): Promise<void> {
  const now = args.now ?? new Date();
  await store.transaction(async (tx) => {
    const block = await tx.getBlock(args.blockId);
    if (!block) throw new RuleError('bed-not-found', `No block ${args.blockId}`);
    const referenceAddress = capped(args.referenceAddress, MAX_ADDRESS_CHARS);
    if (referenceAddress !== '' && referenceAddress !== block.referenceAddress) {
      await tx.updateBlock({ ...block, referenceAddress });
    }
    if (!args.bed) return;

    const bed = await tx.getBed(args.bed.plate);
    if (!bed || bed.blockId !== args.blockId) {
      throw new RuleError('bed-not-found', `No bed ${args.bed.plate} in block ${args.blockId}`);
    }
    const added = Number.isFinite(args.bed.addSlots) ? Math.max(0, Math.floor(args.bed.addSlots)) : 0;
    const slots = Math.min(MAX_BED_SLOTS, bed.slots + added);
    const filled = (await tx.getActiveAdoptions(bed.plate)).length;
    const offeredSlots = offeredSlotCount(args.bed.offeredSlotNumbers, filled, slots);
    await tx.updateBed({
      ...bed,
      slots,
      offeredSlots,
      bedName: args.bed.clearBedName ? null : bed.bedName,
      // The toggle only moves the installed date; a guard toggled off keeps
      // its ordered date, so "ordered" is never lost to a mis-tap. A guard
      // already installed keeps its original date.
      guardInstalledAt: args.bed.guardInstalled ? (bed.guardInstalledAt ?? now.toISOString()) : null,
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
 * `recordHeldOnBehalf: true`, `hasSignInRoute: false`, no secret. A missing
 * email is recorded as exactly that — it is never read as consent to be
 * contacted, and no outreach exists or is invented here (the pen-and-paper
 * contact route is its own later task).
 *
 * The captain may fill a slot the public switches have not offered — writing
 * a neighbour in is the act the page exists for — but never past the bed's
 * physical `slots`.
 */
export async function addStewardByAdmin(
  store: Store,
  args: { plate: string; input: AdminStewardInput; now?: Date },
): Promise<User> {
  const now = args.now ?? new Date();
  const { values, errors } = validateAdminStewardInput(args.input);
  if (Object.keys(errors).length > 0) {
    throw new RuleError('invalid-input', Object.values(errors).join(' '));
  }
  return store.transaction(async (tx) => {
    const bed = await tx.getBed(args.plate);
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
      pinHash: null,
      hasSignInRoute: false,
      recordHeldOnBehalf: true,
      email: values.email,
      phone: values.phone,
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
 * offered, no guard, no tag — and NO NYC identifiers. A planting space ID is
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
  // A tree named in English inside a Spanish sentence is worse than ideal and
  // far better than an English sentence (types.ts) — the field is optional on
  // the form, not in the record.
  const es = capped(args.treeType.es, MAX_TREE_TYPE_CHARS) || en;
  if (en === '') throw new RuleError('invalid-input', 'treeType');
  return store.transaction(async (tx) => {
    const block = await tx.getBlock(args.blockId);
    if (!block) throw new RuleError('bed-not-found', `No block ${args.blockId}`);
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
      guardOrderedAt: null,
      guardInstalledAt: null,
      blockId: args.blockId,
      blockPosition: position,
      nycSyncedAt: null,
      nycMissingSince: null,
    };
    await tx.createBed(bed);
    return bed;
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
