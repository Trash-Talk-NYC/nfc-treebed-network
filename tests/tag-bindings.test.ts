import { describe, expect, it } from 'vitest';
import {
  TAG_BINDINGS,
  assertValidBindings,
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
