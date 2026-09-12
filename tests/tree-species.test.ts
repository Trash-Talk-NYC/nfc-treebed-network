// The checked-in species table: the reason adding a bed never asks a human
// for a Spanish species name. The rules under test are the table's own
// (tree-species.ts): tolerant of case, incidental whitespace, hyphens and
// cultivar quotes; strict about everything else, because a near-miss must
// miss rather than print the wrong species on a neighbour's street.

import { describe, expect, it } from 'vitest';
import {
  englishSpeciesFor,
  GENERIC_TREE,
  normalizeCommonName,
  spanishSpeciesFor,
  speciesTableEntries,
  tableSpeciesCasingFor,
} from '../src/lib/tree-species';
import { MAX_TREE_TYPE_CHARS } from '../src/lib/service';

describe('the species table', () => {
  it('covers every species this repo seeds', () => {
    // The captain's block: five willow oaks and a white oak; the tests'
    // habitual pin oak rides along.
    expect(spanishSpeciesFor('Willow oak')).toBe('roble sauce');
    expect(spanishSpeciesFor('White oak')).toBe('roble blanco');
    expect(spanishSpeciesFor('Pin oak')).toBe('roble palustre');
  });

  it('matches regardless of case, incidental whitespace, hyphens and cultivar quotes', () => {
    expect(spanishSpeciesFor('  WILLOW   OAK  ')).toBe('roble sauce');
    // NYC's census spells it "tulip-poplar"; people type it both ways.
    expect(spanishSpeciesFor('tulip-poplar')).toBe('tulipanero');
    expect(spanishSpeciesFor('Tulip poplar')).toBe('tulipanero');
    expect(spanishSpeciesFor("'Schubert' chokecherry")).toBe('cerezo de Virginia');
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

  it('recognizes the table’s own value shouted, and nothing else', () => {
    // The one predicate both human-facing write paths share: the admin
    // add-bed form and the store remediation script.
    expect(tableSpeciesCasingFor('Willow oak', 'Roble Sauce')).toBe('roble sauce');
    expect(tableSpeciesCasingFor('Willow oak', 'roble sauce')).toBe('roble sauce');
    // A name of their own, including one the table cannot judge.
    expect(tableSpeciesCasingFor('Pin oak', 'Roble de los pantanos')).toBeNull();
    expect(tableSpeciesCasingFor('Willow oak', 'Mi roble favorito')).toBeNull();
    expect(tableSpeciesCasingFor('Dragon tree', 'Drago')).toBeNull();
  });

  it('owns the English casing a name reads with mid-sentence', () => {
    // A common name built from ordinary words is lowercase in the door
    // frame; one carrying a proper adjective keeps its capital there.
    expect(englishSpeciesFor('WILLOW OAK')).toBe('willow oak');
    expect(englishSpeciesFor('norway maple')).toBe('Norway maple');
    expect(englishSpeciesFor('japanese tree lilac')).toBe('Japanese tree lilac');
    expect(englishSpeciesFor('london planetree')).toBe('London planetree');
    expect(englishSpeciesFor('callery pear')).toBe('Callery pear');
    // A name the table does not know is the typist's, untouched by us.
    expect(englishSpeciesFor('Honeylocust')).toBeNull();
    expect(englishSpeciesFor('')).toBeNull();
  });

  it('holds every entry to the table’s own rules', () => {
    const entries = speciesTableEntries();
    // The set is meant to cover NYC's street trees, not a handful.
    expect(entries.length).toBeGreaterThan(100);
    for (const [key, [en, es]] of entries) {
      // The English name is the key's own spelling, so a lookup and what it
      // prints cannot drift; only its casing is authored.
      expect(normalizeCommonName(en), key).toBe(key);
      expect(en.length, key).toBeLessThanOrEqual(MAX_TREE_TYPE_CHARS);
      // Keys are stored pre-normalized, so lookups cannot drift from them.
      expect(key, key).toBe(normalizeCommonName(key));
      // A value is a real name that fits the stored field: never empty,
      // never the generic fallback smuggled in as a species.
      expect(es.trim(), key).toBe(es);
      expect(es, key).not.toBe('');
      expect(es.toLowerCase(), key).not.toBe(GENERIC_TREE.es);
      expect(es.length, key).toBeLessThanOrEqual(MAX_TREE_TYPE_CHARS);
      // Every name lands mid-sentence in the fixed Spanish frame 'El
      // cantero de este …', where an initial capital is ungrammatical; a
      // proper noun inside the name keeps its own ('roble de Shumard').
      const first = [...es][0];
      expect(first, key).toBe(first.toLowerCase());
      expect(first, key).not.toBe(first.toUpperCase());
    }
  });
});
