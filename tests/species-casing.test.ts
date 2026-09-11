// The remediation script's rewrite rule (scripts/species-casing-rewrite.mjs,
// run by scripts/rewrite-species-casing.mjs).
//
// The pilot store was seeded with capitalized Spanish species names before
// the door frame's casing rule existed, and nothing on the read path will
// ever correct a stored field — `normalizeData` is additive by decision. The
// rewrite is what fixes a store already holding them, and the whole risk of
// it is reaching further than casing: these hold it to one field of one
// record type, and to values the checked-in table itself recognizes.

import { describe, expect, it } from 'vitest';
import { rewriteSpeciesCasing } from '../scripts/species-casing-rewrite.mjs';
import { seedData } from '../src/lib/store-dataset';

/** The store as it was seeded before the casing rule — "Roble sauce". */
async function datasetSeededCapitalized() {
  const data = await seedData(null);
  for (const bed of Object.values(data.beds)) {
    const [first, ...rest] = [...bed.treeType.es];
    bed.treeType.es = first.toUpperCase() + rest.join('');
  }
  return data;
}

describe('the Spanish species casing rewrite', () => {
  it('lowercases the capitalized values a pre-rule store was seeded with', async () => {
    const before = await datasetSeededCapitalized();
    expect(Object.values(before.beds).map((b) => b.treeType.es)).toContain('Roble sauce');
    expect(Object.values(before.beds).map((b) => b.treeType.es)).toContain('Roble blanco');

    const { data, changes } = rewriteSpeciesCasing(before);

    expect(changes.length).toBeGreaterThan(0);
    for (const bed of Object.values(data.beds)) {
      const first = [...bed.treeType.es][0];
      expect(first, bed.plate).toBe(first.toLowerCase());
    }
    expect(Object.values(data.beds).map((b) => b.treeType.es)).toContain('roble sauce');
    expect(Object.values(data.beds).map((b) => b.treeType.es)).toContain('roble blanco');
  });

  it('changes nothing on a second run — re-running it is free', async () => {
    const { data: once } = rewriteSpeciesCasing(await datasetSeededCapitalized());
    const { data: twice, changes } = rewriteSpeciesCasing(once);
    expect(changes).toEqual([]);
    expect(twice).toEqual(once);
  });

  it('leaves a human-supplied Spanish name byte-for-byte', async () => {
    const before = await datasetSeededCapitalized();
    const plate = Object.keys(before.beds)[0];
    before.beds[plate].treeType.es = 'Mi roble favorito';
    // A species the table does not know keeps whatever a human gave it.
    const other = Object.keys(before.beds)[1];
    before.beds[other].treeType = { en: 'Honeylocust', es: 'Acacia de tres espinas' };

    const { data, changes } = rewriteSpeciesCasing(before);

    expect(data.beds[plate].treeType.es).toBe('Mi roble favorito');
    expect(data.beds[other].treeType.es).toBe('Acacia de tres espinas');
    expect(changes.map((c) => c.plate)).not.toContain(plate);
    expect(changes.map((c) => c.plate)).not.toContain(other);
  });

  it('touches no other field of any record — not even the English name', async () => {
    const before = await datasetSeededCapitalized();
    const { data } = rewriteSpeciesCasing(before);

    // Everything outside beds is identical, users and events included.
    const { beds: _rewrittenBeds, ...restAfter } = data;
    const { beds: _originalBeds, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
    // And within a bed, only treeType.es moved.
    for (const [plate, bed] of Object.entries(data.beds)) {
      expect({ ...bed, treeType: null }).toEqual({ ...before.beds[plate], treeType: null });
      expect(bed.treeType.en).toBe(before.beds[plate].treeType.en);
    }
  });

  it('does not mutate the dataset it was handed', async () => {
    const before = await datasetSeededCapitalized();
    const snapshot = structuredClone(before);
    rewriteSpeciesCasing(before);
    expect(before).toEqual(snapshot);
  });
});
