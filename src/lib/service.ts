// Server-side rules (spec §7).
//
// Every rule here MUST stay server-side — anything in the browser is editable
// in devtools. This layer is storage-agnostic: it only talks to the narrow
// Store interface, so swapping the persistence backend never touches a rule.

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Store } from './store';
import type { Adoption, Bed, BedEvent, Report, Severity, User } from './types';
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
      | 'username-taken'
      | 'invalid-credentials'
      | 'invalid-input',
    message: string,
  ) {
    super(message);
  }
}

const PIN_ROUNDS = 10;

// bcrypt costs ~100ms of CPU by design. The async variants yield between
// rounds, so one adoption or sign-in can't pin the single-threaded server —
// which matters most on sign-in, the one un-rate-limited path (AGENTS.md).
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_ROUNDS);
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  return bcrypt.compare(pin, pinHash);
}

/** Everything the plaque screens need about one bed, in one read. */
export interface BedView {
  bed: Bed;
  adopters: Array<{ adoption: Adoption; user: User }>;
  openSlots: number;
  openReport: Report | null;
}

export async function getBedView(store: Store, plate: string): Promise<BedView | null> {
  const bed = await store.getBed(plate);
  if (!bed) return null;
  const adoptions = await store.getActiveAdoptions(plate);
  const adopters = [];
  for (const adoption of adoptions) {
    const user = await store.getUser(adoption.userId);
    if (user) adopters.push({ adoption, user });
  }
  return {
    bed,
    adopters,
    openSlots: Math.max(0, bed.slots - adopters.length),
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

export async function fileReport(
  store: Store,
  args: { plate: string; actorId: string; severity: Severity; photoAttached: boolean; now?: Date },
): Promise<Report> {
  const { plate, actorId, severity, photoAttached } = args;
  const now = args.now ?? new Date();
  // One exclusive sequence: two simultaneous tappers must not both pass the
  // single-open-report check and leave a second report nobody can ever close.
  return store.transaction(async (tx) => {
    const bed = await tx.getBed(plate);
    if (!bed) throw new RuleError('bed-not-found', `No bed with plate ${plate}`);

    // A bed carries at most one open report; later tappers confirm or escalate
    // it instead of filing duplicates (spec §6, screen 4).
    const open = await tx.getOpenReport(plate);
    if (open) throw new RuleError('open-report-exists', `Report ${open.id} is already open on ${plate}`);

    if (await hasReportedToday(tx, plate, actorId, now)) {
      throw new RuleError('already-reported-today', `${actorId} already reported ${plate} today`);
    }

    const number = await tx.nextReportNumber();
    // Receipt id keys off the plate's numeric suffix, e.g. RPT-2217-0847.
    const suffix = plate.split('-').at(-1) ?? '0000';
    const report: Report = {
      id: `RPT-${number}-${suffix}`,
      bedPlate: plate,
      reporterId: actorId,
      severity,
      openedAt: now.toISOString(),
      closedAt: null,
      closedBy: null,
      escalatedFrom: null,
      confirmedBy: [],
      photoAttached,
    };
    await tx.createReport(report);
    await appendEvent(tx, plate, 'report', actorId, severity, now);
    return report;
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

/** "STILL THERE — CONFIRM IT". Idempotent per person, and bounded per report. */
export async function confirmReport(
  store: Store,
  args: { plate: string; actorId: string; now?: Date },
): Promise<Report> {
  return store.transaction(async (tx) => {
    const open = await tx.getOpenReport(args.plate);
    if (!open) throw new RuleError('no-open-report', `No open report on ${args.plate}`);
    if (open.confirmedBy.includes(args.actorId)) return open;
    // Full: answered like the repeat confirm above — the screen a visitor
    // lands on is the same either way, and there is nothing here worth an
    // error message about a limit no real neighbourhood reaches.
    if (open.confirmedBy.length >= MAX_CONFIRMATIONS) return open;
    const confirmed: Report = { ...open, confirmedBy: [...open.confirmedBy, args.actorId] };
    await tx.updateReport(confirmed);
    await appendEvent(tx, args.plate, 'confirm', args.actorId, null, args.now);
    return confirmed;
  });
}

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

const USERNAME_RE = /^[a-z0-9_]{2,24}$/i;
const PIN_RE = /^\d{4,8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s().-]{6,19}$/;

export interface AdoptInput {
  name: string;
  username: string;
  pin: string;
  email: string;
  phone: string;
}

/** Field-level validation with explicit messages; returns normalized values. */
export function validateAdoptInput(raw: AdoptInput): { values: AdoptInput; errors: Partial<Record<keyof AdoptInput, string>> } {
  const values: AdoptInput = {
    name: raw.name.trim(),
    username: raw.username.trim().replace(/^@/, ''),
    pin: raw.pin.trim(),
    email: raw.email.trim(),
    phone: raw.phone.trim(),
  };
  const errors: Partial<Record<keyof AdoptInput, string>> = {};
  if (values.name.length < 2) errors.name = 'Tell us your name — it goes on the plaque.';
  if (!USERNAME_RE.test(values.username))
    errors.username = 'Usernames are 2–24 letters, numbers, or underscores.';
  if (!PIN_RE.test(values.pin)) errors.pin = 'PIN must be 4–8 digits.';
  if (!EMAIL_RE.test(values.email)) errors.email = 'That email doesn’t look right.';
  if (!PHONE_RE.test(values.phone)) errors.phone = 'That phone number doesn’t look right.';
  return { values, errors };
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

  // Cheap reads first: /adopt is public, and a bcrypt is ~150–300ms of the one
  // thread that also serves every tap. A POST that cannot possibly store
  // anything — full bed, taken handle — must not buy that CPU. These are a
  // pre-filter, not the rule: the authoritative checks are inside the
  // transaction below, in the same order, so the race is unchanged.
  const preBed = await store.getBed(args.plate);
  if (!preBed) throw new RuleError('bed-not-found', `No bed with plate ${args.plate}`);
  const preActive = await store.getActiveAdoptions(args.plate);
  if (preActive.length >= preBed.slots) {
    throw new RuleError('slots-full', `${args.plate} already has ${preBed.slots} adopters`);
  }
  if (await store.getUserByUsername(values.username)) {
    throw new RuleError('username-taken', `@${values.username} is taken`);
  }

  // Hashed before the transaction opens: nothing about the hash depends on
  // stored state, and holding the store's write queue for the duration of a
  // bcrypt would stall every concurrent tap behind one adoption.
  const pinHash = await hashPin(values.pin);

  // Exclusive: the slot count and the username check are only worth anything
  // if nobody can claim the last slot or the same handle in between.
  return store.transaction(async (tx) => {
    const bed = await tx.getBed(args.plate);
    if (!bed) throw new RuleError('bed-not-found', `No bed with plate ${args.plate}`);

    const active = await tx.getActiveAdoptions(args.plate);
    if (active.length >= bed.slots) {
      throw new RuleError('slots-full', `${args.plate} already has ${bed.slots} adopters`);
    }
    if (await tx.getUserByUsername(values.username)) {
      throw new RuleError('username-taken', `@${values.username} is taken`);
    }

    const user: User = {
      id: `user-${randomUUID()}`,
      name: values.name,
      username: values.username,
      pinHash,
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
  const user = await store.getUserByUsername(args.username.trim().replace(/^@/, ''));
  // Same error AND the same timing for unknown user and wrong PIN — a short
  // circuit here would make username enumeration free, since sign-in attempts
  // are not yet rate limited (AGENTS.md).
  const pinMatches = await verifyPin(args.pin, user?.pinHash ?? (await unmatchablePinHash()));
  if (!user || !pinMatches) {
    throw new RuleError('invalid-credentials', 'Username and PIN don’t match.');
  }
  return user;
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
): Promise<void> {
  await store.appendEvent({
    id: `event-${randomUUID()}`,
    bedPlate,
    eventType,
    severity,
    actorId,
    createdAt: (now ?? new Date()).toISOString(),
  });
}
