// Server-side rules (spec §7).
//
// Every rule here MUST stay server-side — anything in the browser is editable
// in devtools. This layer is storage-agnostic: it only talks to the narrow
// Store interface, so swapping the persistence backend never touches a rule.

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { boundFromEnv } from './bounds';
import type { Store } from './store';
import type { Adoption, Bed, BedEvent, Report, Severity, User } from './types';
import type { ProblemCategory } from './problem';
import { MAX_NOTE_CHARS } from './problem';
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
 * only work a flood can buy there is two slots' worth of reads.
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
    openSlots: Math.max(0, bed.slots - stewards.length),
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
  category: ProblemCategory;
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
  const { plate, actorId, category, photoAttached } = args;
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
      // Their category and their sentence ride on the `confirm` event: the
      // report already belongs to the first reporter, but what the second
      // neighbour said has to reach the steward rather than be thanked for and
      // dropped. The photo flag moves onto the report, because it is true of
      // the bed's open problem that somebody attached one.
      // No new growth concern: the note is capped at `MAX_NOTE_CHARS` above and
      // the confirmations this rides alongside are bounded by
      // `MAX_CONFIRMATIONS`, so both the array and the events it adds stop.
      const weighted: Report = {
        ...open,
        confirmedBy: [...open.confirmedBy, actorId],
        photoAttached: open.photoAttached || photoAttached,
      };
      await tx.updateReport(weighted);
      await appendEvent(tx, plate, 'confirm', actorId, null, now, {
        category,
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
      category,
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
      category,
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
    await appendEvent(tx, args.plate, 'escalate', args.actorId, 'dumping', args.now);
    return raised;
  });
}

/**
 * Closes whoever's report is open. Actor-agnostic, as spec §2 asks — anyone can
 * mark clear, and stale reports otherwise read as adopter neglect.
 *
 * Who may reach it is the route's business, and `/clear` currently admits only
 * a signed-in adopter of the bed; see AGENTS.md for why, and for what re-opening
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
    await appendEvent(tx, args.plate, 'clear', args.actorId, null, now);
    return closed;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s().-]{6,19}$/;

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

/** Field-level validation; returns normalized values and error codes. */
export function validateAdoptInput(raw: AdoptInput): { values: AdoptInput; errors: AdoptErrors } {
  const values: AdoptInput = {
    firstName: raw.firstName.trim(),
    lastName: raw.lastName.trim(),
    email: raw.email.trim(),
    phone: raw.phone.trim(),
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
  if (active.length >= bed.slots) {
    throw new RuleError('slots-full', `${plate} already has ${bed.slots} stewards`);
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

/** Two-slot cap (spec §7) enforced here, server-side. */
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

    // Resolved inside the transaction, against the users it will commit
    // alongside: two neighbours with the same name adopting at the same moment
    // must not both be handed the same handle.
    const existing = new Set<string>();
    for (const other of await tx.getActiveAdoptions(args.plate)) {
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

async function appendEvent(
  store: Store,
  bedPlate: string,
  eventType: BedEvent['eventType'],
  actorId: string | null,
  severity: Severity | null,
  now?: Date,
  said?: { category: ProblemCategory | null; note: string; reportId: string },
): Promise<void> {
  await store.appendEvent({
    id: `event-${randomUUID()}`,
    bedPlate,
    eventType,
    severity,
    category: said?.category ?? null,
    note: said?.note ?? '',
    reportId: said?.reportId ?? null,
    actorId,
    createdAt: (now ?? new Date()).toISOString(),
  });
}
