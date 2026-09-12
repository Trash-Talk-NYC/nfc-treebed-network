// Carrying a steward from one bed's record to another's — the one rule, in a
// LEAF module both callers share.
//
// Why it exists: the captain's 2026-09-12 named bed ids seed 22 fresh records
// (store-dataset.ts, `captainRunBeds`), and some of the six earlier W 171st
// beds are physically among them — his own real adoption on BED-WH-1711
// included. His street numbers are loose cluster references, his words, not
// locators, so nothing can MAP the old records onto the new ids. The day he
// stands at the tree and says which of the 22 is his, the steward MOVES:
// `carryStewardByAdmin` (service.ts) runs this inside a store transaction,
// and `scripts/carry-steward.mjs` runs it against the live Blobs store as a
// forward revision.
//
// Why a leaf: the remediation scripts are plain `.mjs` run by bare `node`,
// which resolves a `.ts` import only when every import below it names its
// file extension — service.ts and store-dataset.ts do not, so the script
// cannot reach the rule through them (store-keys.ts records the same
// constraint). Everything imported here is either type-only (erased by type
// stripping) or a real `node:` module, and must stay that way.
//
// What a carry does: releases the steward's active adoption on `fromPlate`
// and creates one on `toPlate` that carries everything the old one said —
// `adoptedAt` (the stewardship did not restart; the record was on the wrong
// bed), `stewardKind`, `displayNameHidden` — plus a `release` and an `adopt`
// event so both beds' histories say what happened. Nothing else moves:
// reports, events and the bed's given name stay keyed where they were
// written, because sites own history and a correction must not rewrite it.
//
// REVERSIBLE by construction: running it again with the plates swapped
// restores the original state — same user, same `adoptedAt` — with the
// released rows left in place as the record of the detour. Both directions
// refuse rather than guess.

import { randomUUID } from 'node:crypto';
import type { Adoption, Bed, BedEvent } from './types';

/**
 * A refusal the rule made on purpose; `code` matches service.ts RuleError
 * codes. No parameter properties here — Node's strip-only TS loading (what
 * lets the script import this file) erases types but performs no transforms,
 * and a parameter property is a transform.
 */
export class CarryRefusal extends Error {
  readonly code: 'bed-not-found' | 'invalid-input' | 'slots-full';

  constructor(code: 'bed-not-found' | 'invalid-input' | 'slots-full', message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * What the rule needs from whoever holds the records. `TransactionStore`
 * satisfies it structurally (the service path); the script satisfies it with
 * a few lines over the raw dataset (`carryStewardInData`).
 */
export interface CarryPort {
  getBed(plate: string): Promise<Bed | null>;
  /** Active (non-released) adoptions for a bed. */
  getActiveAdoptions(bedPlate: string): Promise<Adoption[]>;
  updateAdoption(adoption: Adoption): Promise<void>;
  createAdoption(adoption: Adoption): Promise<void>;
  appendEvent(event: BedEvent): Promise<void>;
}

export interface CarryArgs {
  userId: string;
  fromPlate: string;
  toPlate: string;
  now?: Date;
}

/**
 * The carry itself. The caller owns atomicity: service.ts runs this inside
 * `store.transaction`, the script inside one forward-revision commit.
 *
 * The source may be retired — carrying a steward OFF a bed the admin has
 * already deleted is a legitimate cleanup order — but the target must be a
 * live bed: a steward may not be carried onto a tombstone. Like
 * `addStewardByAdmin`, the carry may fill an unoffered slot (the admin
 * placing a person is the point) but never past the physical `slots`.
 */
export async function carrySteward(port: CarryPort, args: CarryArgs): Promise<Adoption> {
  const now = args.now ?? new Date();
  if (args.fromPlate === args.toPlate) {
    throw new CarryRefusal('invalid-input', 'fromPlate and toPlate are the same bed');
  }
  const from = await port.getBed(args.fromPlate);
  if (!from) throw new CarryRefusal('bed-not-found', `No bed with plate ${args.fromPlate}`);
  const to = await port.getBed(args.toPlate);
  if (!to || to.retiredAt !== null) {
    throw new CarryRefusal('bed-not-found', `No active bed with plate ${args.toPlate}`);
  }

  const carried = (await port.getActiveAdoptions(args.fromPlate)).find(
    (a) => a.userId === args.userId,
  );
  if (!carried) {
    throw new CarryRefusal(
      'invalid-input',
      `${args.userId} holds no active adoption on ${args.fromPlate}`,
    );
  }
  const atTarget = await port.getActiveAdoptions(args.toPlate);
  if (atTarget.some((a) => a.userId === args.userId)) {
    throw new CarryRefusal('invalid-input', `${args.userId} already stewards ${args.toPlate}`);
  }
  if (atTarget.length >= to.slots) {
    throw new CarryRefusal('slots-full', `${args.toPlate} already has ${to.slots} stewards`);
  }

  await port.updateAdoption({ ...carried, releasedAt: now.toISOString() });
  const adoption: Adoption = {
    id: `adoption-${randomUUID()}`,
    bedPlate: args.toPlate,
    userId: carried.userId,
    adoptedAt: carried.adoptedAt,
    stewardKind: carried.stewardKind,
    displayNameHidden: carried.displayNameHidden,
    releasedAt: null,
  };
  await port.createAdoption(adoption);
  const event = (bedPlate: string, eventType: 'release' | 'adopt'): BedEvent => ({
    id: `event-${randomUUID()}`,
    bedPlate,
    eventType,
    severity: null,
    categories: [],
    note: '',
    reportId: null,
    actorId: carried.userId,
    createdAt: now.toISOString(),
  });
  await port.appendEvent(event(args.fromPlate, 'release'));
  await port.appendEvent(event(args.toPlate, 'adopt'));
  return adoption;
}

/**
 * The dataset-shaped port the script uses: the same rule applied straight to
 * a raw `Data` object (a Blobs revision the script has read). MUTATES `data`;
 * the script clones before calling, the way every forward revision is built.
 * The few lines here mirror `ops` in store-dataset.ts, which the script
 * cannot load (see the header).
 */
export function dataCarryPort(data: {
  beds: Record<string, Bed>;
  adoptions: Adoption[];
  events: BedEvent[];
}): CarryPort {
  return {
    async getBed(plate) {
      return data.beds[plate] ?? null;
    },
    async getActiveAdoptions(bedPlate) {
      return data.adoptions.filter((a) => a.bedPlate === bedPlate && a.releasedAt === null);
    },
    async updateAdoption(adoption) {
      const i = data.adoptions.findIndex((a) => a.id === adoption.id);
      if (i === -1) throw new Error(`Adoption not found: ${adoption.id}`);
      data.adoptions[i] = adoption;
    },
    async createAdoption(adoption) {
      data.adoptions.push(adoption);
    },
    async appendEvent(event) {
      data.events.push(event);
    },
  };
}
