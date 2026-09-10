// Which site each physical tag resolves to.
//
// A tag is an object and a site is a place, and the two meet only here. The
// URL in the chip carries an opaque ID (tag-id.ts); every screen and rule is
// keyed by the site's plate, so this registry is the one seam between them.
// That split is what survives theft: a stolen tag is retired here and a fresh
// one bound to the same plate, and the site's reports and events — all keyed
// by the plate — carry on untouched. Nothing about the site's history lives
// on the tag.
//
// The registry is a checked-in table, deliberately, not a Store table:
//  - The team binds the pilot tags itself; the map records paperwork binding
//    as sufficient until roughly the twentieth tag, and the in-field claim
//    flow that would need runtime writes is its own later ticket. Until it
//    exists there is no code path that changes a binding — an edit here, with
//    review and a deploy, *is* the binding procedure.
//  - When the claim flow lands, this moves behind the Store interface with a
//    write path; the resolver below is the only thing the routes call, so
//    that swap touches this file and nothing else.
//
// To bind a new tag: add a row. To retire one (stolen, dead, re-sited): set
// its `retiredAt` and, if a replacement goes in, add a new row for the same
// plate. Never delete a row — a retired row is the record of where that tag
// was, and a tapped retired tag should say "not assigned", not 500.

import { isCanonicalTagId, normalizeTagId } from './tag-id';

export interface TagBinding {
  /** Canonical tag ID (tag-id.ts) — exactly what /t/<id> normalizes to. */
  tagId: string;
  /** The site the tag is bound to, as the store keys it: the bed's plate. */
  sitePlate: string;
  boundAt: string;
  /** Set when the tag stops speaking for the site; the row stays. */
  retiredAt: string | null;
}

/**
 * The tag on the hand-seeded demo bed. The site root redirects here and
 * nowhere else: root traffic is monitors, crawlers and typed domains, and
 * pointing it at a real bed would inflate that bed's tap count.
 */
export const DEMO_TAG_ID = '2mq2amhv';

export const TAG_BINDINGS: readonly TagBinding[] = [
  // The one hand-seeded bed (store-local.ts) and the demo tag bound to it.
  { tagId: DEMO_TAG_ID, sitePlate: 'BED-HRL-0847', boundAt: '2026-08-26T12:00:00.000Z', retiredAt: null },
  // The four willow oaks at the Haven end of W 171st (positions 1–4, fronting
  // 718 and 708 — store-dataset.ts): the first real beds the captain taps.
  // These four IDs were MINTED HERE, in this repo, ahead of the guards going
  // in — nothing was read off hardware and no chip has been encoded with any
  // of them yet. So this file is not a record of what is on the chips: it is
  // the SOURCE for what must be written to them, and whoever encodes them
  // must write these exact IDs. The ID is opaque and carries no meaning, so a
  // mismatch cannot be repaired by editing a row here — it means physically
  // visiting the tag and re-encoding it.
  // The guards these tags will mount on are ordered, not installed, and the
  // beds stay unoffered (`offeredSlots: 0`) until the captain opens them — so
  // each of these renders the not-yet-open door, which is the state being
  // shown, not a bug.
  { tagId: 'jjhq9gfj', sitePlate: 'BED-WH-1711', boundAt: '2026-09-10T19:00:00.000Z', retiredAt: null },
  { tagId: '1hc0t9cj', sitePlate: 'BED-WH-1712', boundAt: '2026-09-10T19:00:00.000Z', retiredAt: null },
  { tagId: '729v19w4', sitePlate: 'BED-WH-1713', boundAt: '2026-09-10T19:00:00.000Z', retiredAt: null },
  { tagId: 'jpv8bksx', sitePlate: 'BED-WH-1714', boundAt: '2026-09-10T19:00:00.000Z', retiredAt: null },
];

/**
 * The binding that currently speaks for `tagId`, or null. Takes a canonical
 * ID (a route has always normalized by the time it has a URL to build).
 */
export function activeBinding(
  bindings: readonly TagBinding[],
  tagId: string,
): TagBinding | null {
  return bindings.find((b) => b.tagId === tagId && b.retiredAt === null) ?? null;
}

/**
 * The active binding for the demo tag, or null once it is retired or removed.
 * Named rather than positional so the root redirect cannot drift onto a real
 * bed when the registry is reordered.
 */
export function demoBinding(
  bindings: readonly TagBinding[] = TAG_BINDINGS,
): TagBinding | null {
  return activeBinding(bindings, DEMO_TAG_ID);
}

/**
 * Everything a route needs to know about its `[tag]` param, in the three
 * states a tapped URL can be in:
 *   invalid  not a tag ID at all → 404
 *   unbound  a well-formed ID no active binding speaks for — a tag encoded
 *            but not yet assigned, or one since retired. A normal state, not
 *            an error: bulk-encoded tags may sit in the wood before anyone
 *            binds them.
 *   bound    resolves to a site; `plate` keys every read and rule from here.
 */
export type TagResolution =
  | { state: 'invalid' }
  | { state: 'unbound'; tag: string }
  | { state: 'bound'; tag: string; plate: string };

export function resolveTagParam(
  raw: string | undefined,
  bindings: readonly TagBinding[] = TAG_BINDINGS,
): TagResolution {
  const tag = normalizeTagId(raw ?? '');
  if (tag === null) return { state: 'invalid' };
  const binding = activeBinding(bindings, tag);
  if (!binding) return { state: 'unbound', tag };
  return { state: 'bound', tag, plate: binding.sitePlate };
}

/**
 * What must hold for the registry to make sense; throws on the edit that
 * breaks it. Two active rows for one tag would make /t/<id> ambiguous — one
 * tag is on one guard. Two active tags for one *site* are legal (a plaque tag
 * and a rail tag can both name the bed), which is why only the tag side is
 * unique.
 */
export function assertValidBindings(bindings: readonly TagBinding[]): void {
  const active = new Set<string>();
  for (const b of bindings) {
    if (!isCanonicalTagId(b.tagId)) {
      throw new Error(`tag-bindings: "${b.tagId}" is not a canonical tag ID`);
    }
    if (b.retiredAt !== null) continue;
    if (active.has(b.tagId)) {
      throw new Error(`tag-bindings: "${b.tagId}" has two active bindings`);
    }
    active.add(b.tagId);
  }
}

assertValidBindings(TAG_BINDINGS);
