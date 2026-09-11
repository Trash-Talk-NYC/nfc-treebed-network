// The checked-in species table: the reason adding a bed never asks a human
// for a Spanish species name. The rules under test are the table's own
// (tree-species.ts): tolerant of case, incidental whitespace, hyphens and
// cultivar quotes; strict about everything else, because a near-miss must
// miss rather than print the wrong species on a neighbour's street.

import { describe, expect, it } from 'vitest';
import {
  GENERIC_TREE,
  normalizeCommonName,
  spanishSpeciesFor,
  speciesTableEntries,
} from '../src/lib/tree-species';
import { MAX_TREE_TYPE_CHARS } from '../src/lib/service';

describe('the species table', () => {
  it('covers every species this repo seeds', () => {
    // The captain's block: five willow oaks and a white oak; the tests'
    // habitual pin oak rides along.
    expect(spanishSpeciesFor('Willow oak')).toBe('Roble sauce');
    expect(spanishSpeciesFor('White oak')).toBe('Roble blanco');
    expect(spanishSpeciesFor('Pin oak')).toBe('Roble palustre');
  });

  it('matches regardless of case, incidental whitespace, hyphens and cultivar quotes', () => {
    expect(spanishSpeciesFor('  WILLOW   OAK  ')).toBe('Roble sauce');
    // NYC's census spells it "tulip-poplar"; people type it both ways.
    expect(spanishSpeciesFor('tulip-poplar')).toBe('Tulipanero');
    expect(spanishSpeciesFor('Tulip poplar')).toBe('Tulipanero');
    expect(spanishSpeciesFor("'Schubert' chokecherry")).toBe('Cerezo de Virginia');
  });

  it('answers null for a name it does not know — a near-miss misses', () => {
    expect(spanishSpeciesFor('dragon tree')).toBeNull();
    // A plural is not the species.
    expect(spanishSpeciesFor('willow oaks')).toBeNull();
    // Deliberately absent: its accepted Spanish names are feminine, and the
    // door frame is "El cantero de este …" — see the table's own comment.
    expect(spanishSpeciesFor('honeylocust')).toBeNull();
    expect(spanishSpeciesFor('')).toBeNull();
  });

  it('holds every entry to the table’s own rules', () => {
    const entries = speciesTableEntries();
    // The set is meant to cover NYC's street trees, not a handful.
    expect(entries.length).toBeGreaterThan(100);
    for (const [key, es] of entries) {
      // Keys are stored pre-normalized, so lookups cannot drift from them.
      expect(key, key).toBe(normalizeCommonName(key));
      // A value is a real name that fits the stored field: never empty,
      // never the generic fallback smuggled in as a species.
      expect(es.trim(), key).toBe(es);
      expect(es, key).not.toBe('');
      expect(es.toLowerCase(), key).not.toBe(GENERIC_TREE.es);
      expect(es.length, key).toBeLessThanOrEqual(MAX_TREE_TYPE_CHARS);
    }
  });
});
