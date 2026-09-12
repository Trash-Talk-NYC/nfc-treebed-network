// The remediation script's rewrite rule (scripts/species-casing-rewrite.mjs,
// run by scripts/rewrite-species-casing.mjs).
//
// The pilot store was seeded with capitalized species names — "Roble sauce",
// "Willow oak" — before the door frame's casing rule existed, and nothing on
// the read path will ever correct a stored field: `normalizeData` is additive
// by decision. The rewrite is what fixes a store already holding them, and
// the whole risk of it is reaching further than casing: these hold it to one
// field of one record type, and to values the checked-in table itself
// recognizes — in either language.

import { describe, expect, it } from 'vitest';
import { rewriteSpeciesCasing } from '../scripts/species-casing-rewrite.mjs';
import { seedData } from '../src/lib/store-dataset';

/**
 * The store as it was seeded before the casing rule — "Roble sauce". The 22
 * captain-run beds seed with no species at all (`treeType: null`, not yet
 * recorded) and are skipped: a pre-rule store never held them capitalized,
 * and the rewrite has nothing to say about a species nobody recorded.
 */
async function datasetSeededCapitalized() {
  const data = seedData();
  for (const bed of Object.values(data.beds)) {
    if (bed.treeType === null) continue;
    bed.treeType.es = capitalize(bed.treeType.es);
    bed.treeType.en = capitalize(bed.treeType.en);
  }
  return data;
}

function capitalize(name: string): string {
  const [first, ...rest] = [...name];
  return first!.toUpperCase() + rest.join('');
}

describe('the species casing rewrite', () => {
  it('lowercases the capitalized Spanish values a pre-rule store was seeded with', async () => {
    const before = await datasetSeededCapitalized();
    expect(Object.values(before.beds).map((b) => b.treeType?.es)).toContain('Roble sauce');
    expect(Object.values(before.beds).map((b) => b.treeType?.es)).toContain('Roble blanco');

    const { data, changes } = rewriteSpeciesCasing(before);

    expect(changes.some((c) => c.field === 'es')).toBe(true);
    for (const bed of Object.values(data.beds)) {
      if (bed.treeType === null) continue;
      const first = [...bed.treeType.es][0]!;
      expect(first, bed.plate).toBe(first.toLowerCase());
    }
    expect(Object.values(data.beds).map((b) => b.treeType?.es)).toContain('roble sauce');
    expect(Object.values(data.beds).map((b) => b.treeType?.es)).toContain('roble blanco');
  });

  it('changes nothing on a second run — re-running it is free', async () => {
    const { data: once } = rewriteSpeciesCasing(await datasetSeededCapitalized());
    const { data: twice, changes } = rewriteSpeciesCasing(once);
    expect(changes).toEqual([]);
    expect(twice).toEqual(once);
  });

  it("puts the English name back to the table's own spelling", async () => {
    const before = await datasetSeededCapitalized();
    expect(Object.values(before.beds).map((b) => b.treeType?.en)).toContain('Willow oak');

    const { data, changes } = rewriteSpeciesCasing(before);

    expect(Object.values(data.beds).map((b) => b.treeType?.en)).toContain('willow oak');
    expect(Object.values(data.beds).map((b) => b.treeType?.en)).toContain('white oak');
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'en', from: 'Willow oak', to: 'willow oak' }),
    );
  });

  it("keeps an English proper adjective the table authored with its capital", async () => {
    const before = await datasetSeededCapitalized();
    const plate = Object.keys(before.beds)[0];
    before.beds[plate].treeType = { en: 'norway maple', es: 'arce noruego' };

    const { data } = rewriteSpeciesCasing(before);

    expect(data.beds[plate].treeType).toEqual({ en: 'Norway maple', es: 'arce noruego' });
  });

  it('leaves a species the table does not know exactly as typed, in both languages', async () => {
    const before = await datasetSeededCapitalized();
    const plate = Object.keys(before.beds)[0];
    before.beds[plate].treeType = { en: 'Honeylocust', es: 'Acacia de tres espinas' };

    const { data, changes, kept } = rewriteSpeciesCasing(before);

    expect(data.beds[plate].treeType).toEqual({ en: 'Honeylocust', es: 'Acacia de tres espinas' });
    expect(changes.map((c) => c.plate)).not.toContain(plate);
    // And it says so, per field, rather than passing over it in silence.
    expect(kept).toContainEqual(expect.objectContaining({ plate, field: 'en', value: 'Honeylocust' }));
    expect(kept).toContainEqual(
      expect.objectContaining({ plate, field: 'es', value: 'Acacia de tres espinas' }),
    );
  });

  it('reports what it left alone as well as what it changed', async () => {
    const { data: once, kept: keptFirst } = rewriteSpeciesCasing(await datasetSeededCapitalized());
    expect(keptFirst.every((k) => k.reason.length > 0)).toBe(true);

    const { changes, kept } = rewriteSpeciesCasing(once);

    // On a store that needs nothing, every recorded species is still accounted for.
    expect(changes).toEqual([]);
    const recorded = Object.values(once.beds).filter((b) => b.treeType !== null);
    expect(kept).toHaveLength(recorded.length * 2);
  });

  it('leaves a human-supplied Spanish name byte-for-byte', async () => {
    const before = await datasetSeededCapitalized();
    const plate = Object.keys(before.beds)[0];
    before.beds[plate].treeType!.es = 'Mi roble favorito';
    // A species the table does not know keeps whatever a human gave it.
    const other = Object.keys(before.beds)[1];
    before.beds[other].treeType = { en: 'Honeylocust', es: 'Acacia de tres espinas' };

    const { data, changes } = rewriteSpeciesCasing(before);

    expect(data.beds[plate].treeType!.es).toBe('Mi roble favorito');
    expect(data.beds[other].treeType!.es).toBe('Acacia de tres espinas');
    // The English half of that first bed is the table's own name and is still
    // corrected — what is left alone is the name the human wrote.
    const spanish = changes.filter((c) => c.field === 'es').map((c) => c.plate);
    expect(spanish).not.toContain(plate);
    expect(changes.map((c) => c.plate)).not.toContain(other);
  });

  it('touches no field of any record but the two species names', async () => {
    const before = await datasetSeededCapitalized();
    const { data } = rewriteSpeciesCasing(before);

    // Everything outside beds is identical, users and events included.
    const { beds: _rewrittenBeds, ...restAfter } = data;
    const { beds: _originalBeds, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
    // And within a bed, only treeType moved.
    for (const [plate, bed] of Object.entries(data.beds)) {
      expect({ ...bed, treeType: null }).toEqual({ ...before.beds[plate], treeType: null });
    }
  });

  it('does not mutate the dataset it was handed', async () => {
    const before = await datasetSeededCapitalized();
    const snapshot = structuredClone(before);
    rewriteSpeciesCasing(before);
    expect(before).toEqual(snapshot);
  });
});
