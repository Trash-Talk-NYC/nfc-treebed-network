import { describe, expect, it } from 'vitest';
import {
  DEMO_TAG_ID,
  TAG_BINDINGS,
  assertValidBindings,
  demoBinding,
  resolveTagParam,
  type TagBinding,
} from '../src/lib/tag-bindings';

describe('the shipped registry', () => {
  it('binds the seeded demo bed, so the app renders on first run', () => {
    const seeded = TAG_BINDINGS.find((b) => b.sitePlate === 'BED-HRL-0847' && b.retiredAt === null);
    expect(seeded).toBeDefined();
    expect(resolveTagParam(seeded!.tagId)).toEqual({
      state: 'bound',
      tag: seeded!.tagId,
      plate: 'BED-HRL-0847',
    });
  });

  it('binds the four Haven-end W 171st beds, one tag each', () => {
    // The first real tags of the pilot: positions 1–4, the willow oaks with
    // guards on order (store-dataset.ts). Pinned tag-by-tag because these IDs
    // are what firstmate hands the captain as links — a swapped pair would
    // still be a valid registry and still be wrong.
    const expected: Record<string, string> = {
      jjhq9gfj: 'BED-WH-1711',
      '1hc0t9cj': 'BED-WH-1712',
      '729v19w4': 'BED-WH-1713',
      jpv8bksx: 'BED-WH-1714',
    };
    for (const [tagId, plate] of Object.entries(expected)) {
      expect(resolveTagParam(tagId)).toEqual({ state: 'bound', tag: tagId, plate });
    }
  });
});

describe('the captain’s named runs (2026-09-12)', () => {
  /** The 20 named ids that ARE the plate of a fresh run bed. */
  const freshNamed = [
    ...[1, 2, 3, 4, 5, 6].map((n) => `${n}E170171HFW`),
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => `${n}SHFW171`),
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => `${n}NHFW171`),
  ];

  it('binds the 20 fresh named ids, each to the bed of the same name', () => {
    // The id IS the bed id (the captain: "it's supposed to be the url
    // actually and the bed id"): the tag is the plate's own lowercase
    // canonical, so what a chip encoder reads here and what the admin says
    // out loud are the same string.
    for (const plate of freshNamed) {
      const tagId = plate.toLowerCase();
      expect(resolveTagParam(tagId)).toEqual({ state: 'bound', tag: tagId, plate });
    }
  });

  it('resolves the id exactly as the captain spells it — uppercase, off the guard', () => {
    expect(resolveTagParam('1NHFW171')).toEqual({
      state: 'bound',
      tag: '1nhfw171',
      plate: '1NHFW171',
    });
    expect(resolveTagParam('4E170171HFW')).toEqual({
      state: 'bound',
      tag: '4e170171hfw',
      plate: '4E170171HFW',
    });
  });

  it('binds 8NHFW171 and 9NHFW171 to the existing beds the captain identified', () => {
    // His words: "Can you change …/t/1hc0t9cj for the end to be 9NHFW171 and
    // then …/t/729v19w4 change to 8NHFW171" — a rename of two beds this
    // network already held, never two fresh records beside them.
    expect(resolveTagParam('9NHFW171')).toEqual({
      state: 'bound',
      tag: '9nhfw171',
      plate: 'BED-WH-1712',
    });
    expect(resolveTagParam('8NHFW171')).toEqual({
      state: 'bound',
      tag: '8nhfw171',
      plate: 'BED-WH-1713',
    });
  });

  it('keeps the old tags of the renamed beds live beside the named ids', () => {
    // The captain asked for these links before the rename and may already
    // have handed them out: both URLs must keep opening the same bed.
    // Retiring the old rows is his later call, never a rename side effect.
    expect(resolveTagParam('1hc0t9cj')).toEqual({
      state: 'bound',
      tag: '1hc0t9cj',
      plate: 'BED-WH-1712',
    });
    expect(resolveTagParam('729v19w4')).toEqual({
      state: 'bound',
      tag: '729v19w4',
      plate: 'BED-WH-1713',
    });
  });

  it('leaves the other four earlier W 171st beds on their opaque tags alone', () => {
    // The captain has named only these two; which run beds the other four
    // are stays unknown, so no other named id points at a BED-WH plate — the
    // carry (steward-carry.ts) plus a binding is the path for that day.
    const renamedPlates = new Set(['BED-WH-1712', 'BED-WH-1713']);
    for (const binding of TAG_BINDINGS) {
      if (binding.sitePlate.startsWith('BED-WH-') && !renamedPlates.has(binding.sitePlate)) {
        expect(freshNamed.map((p) => p.toLowerCase())).not.toContain(binding.tagId);
        expect(binding.tagId).toHaveLength(8);
      }
    }
    expect(resolveTagParam('jjhq9gfj')).toEqual({
      state: 'bound',
      tag: 'jjhq9gfj',
      plate: 'BED-WH-1711',
    });
  });
});

describe('the binding the site root redirects to', () => {
  const boundAt = '2026-08-26T12:00:00.000Z';
  const real: TagBinding = { tagId: 'jjhq9gfj', sitePlate: 'BED-WH-1711', boundAt, retiredAt: null };
  const demo: TagBinding = { tagId: DEMO_TAG_ID, sitePlate: 'BED-HRL-0847', boundAt, retiredAt: null };

  it('is the demo bed in the shipped registry', () => {
    expect(demoBinding()?.sitePlate).toBe('BED-HRL-0847');
  });

  it('is the demo tag even when a real bed sits first — root traffic must never land on one', () => {
    // Monitors, crawlers and typed domains all arrive here; a positional pick
    // would inflate whichever real bed happened to lead the table.
    expect(demoBinding([real, demo])).toEqual(demo);
  });

  it('is null once the demo tag is retired, so the root fails loudly instead of picking a real bed', () => {
    expect(demoBinding([real, { ...demo, retiredAt: '2026-09-01T09:00:00.000Z' }])).toBeNull();
    expect(demoBinding([real])).toBeNull();
  });
});

describe('resolving a tag param', () => {
  const bindings: TagBinding[] = [
    { tagId: '2mq2amhv', sitePlate: 'BED-HRL-0847', boundAt: '2026-08-26T12:00:00.000Z', retiredAt: null },
  ];

  it('normalizes before looking up — a mistyped tag still resolves', () => {
    expect(resolveTagParam('2MQ2-AMHV', bindings)).toEqual({
      state: 'bound',
      tag: '2mq2amhv',
      plate: 'BED-HRL-0847',
    });
  });

  it('answers invalid for what is not a tag ID at all', () => {
    expect(resolveTagParam(undefined, bindings)).toEqual({ state: 'invalid' });
    expect(resolveTagParam('', bindings)).toEqual({ state: 'invalid' });
    expect(resolveTagParam('BED-HRL-0847', bindings)).toEqual({ state: 'invalid' });
  });

  it('answers unbound, with the canonical ID, for a well-formed tag nobody has bound', () => {
    // A freshly-encoded tag in the wood before binding: normal, not an error.
    expect(resolveTagParam('7zzzzzz0', bindings)).toEqual({ state: 'unbound', tag: '7zzzzzz0' });
  });
});

describe('retiring a tag and binding a replacement', () => {
  // The theft story: tag one is pried off, tag two goes into the same guard.
  const boundAt = '2026-08-26T12:00:00.000Z';
  const afterTheft: TagBinding[] = [
    { tagId: '2mq2amhv', sitePlate: 'BED-HRL-0847', boundAt, retiredAt: '2026-09-01T09:00:00.000Z' },
    { tagId: '7zzzzzz0', sitePlate: 'BED-HRL-0847', boundAt: '2026-09-02T09:00:00.000Z', retiredAt: null },
  ];

  it('the replacement resolves to the same site — its history is keyed by plate, so nothing is lost', () => {
    expect(resolveTagParam('7zzzzzz0', afterTheft)).toEqual({
      state: 'bound',
      tag: '7zzzzzz0',
      plate: 'BED-HRL-0847',
    });
  });

  it('the retired tag stops resolving but does not become an error', () => {
    expect(resolveTagParam('2mq2amhv', afterTheft)).toEqual({ state: 'unbound', tag: '2mq2amhv' });
  });

  it('is a valid registry: retirement is what frees the tag side up', () => {
    expect(() => assertValidBindings(afterTheft)).not.toThrow();
  });
});

describe('registry validation', () => {
  const boundAt = '2026-08-26T12:00:00.000Z';

  it('accepts the shipped registry', () => {
    expect(() => assertValidBindings(TAG_BINDINGS)).not.toThrow();
  });

  it('rejects a non-canonical tag ID — the registry stores what URLs normalize to', () => {
    expect(() =>
      assertValidBindings([{ tagId: '2MQ2AMHV', sitePlate: 'BED-HRL-0847', boundAt, retiredAt: null }]),
    ).toThrow(/canonical/);
  });

  it('rejects two active bindings for one tag — one tag is on one guard', () => {
    expect(() =>
      assertValidBindings([
        { tagId: '2mq2amhv', sitePlate: 'BED-HRL-0847', boundAt, retiredAt: null },
        { tagId: '2mq2amhv', sitePlate: 'BED-HRL-0001', boundAt, retiredAt: null },
      ]),
    ).toThrow(/two active/);
  });

  it('accepts two active tags for one site — a plaque tag and a rail tag can both name the bed', () => {
    expect(() =>
      assertValidBindings([
        { tagId: '2mq2amhv', sitePlate: 'BED-HRL-0847', boundAt, retiredAt: null },
        { tagId: '7zzzzzz0', sitePlate: 'BED-HRL-0847', boundAt, retiredAt: null },
      ]),
    ).not.toThrow();
  });
});
