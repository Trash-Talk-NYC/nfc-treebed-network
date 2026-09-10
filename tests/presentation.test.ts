import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defaultPresentation, presentationFor, themeStyle, themeVar } from '../src/lib/presentation';
import { PROBLEMS } from '../src/lib/problem';
import type { Bed } from '../src/lib/types';

const BED: Bed = {
  plate: 'BED-HRL-0847',
  plantingSpaceId: '15850293',
  plantingSpaceGlobalId: null,
  treeType: { en: 'Willow oak', es: 'Roble sauce' },
  treeId: '08-4211',
  tagUid: '04:A2:2F:9C',
  crossStreets: 'W 138 St × Adam Clayton Powell Jr Blvd',
  address: '2300 Adam Clayton Powell Jr Blvd, New York, NY 10030',
  slots: 2,
  offeredSlots: 2,
  guardOrderedAt: null,
  guardInstalledAt: '2026-04-18T16:00:00.000Z',
  blockId: null,
  blockPosition: null,
  nycSyncedAt: null,
  nycMissingSince: null,
};

/** WCAG relative luminance, then the contrast ratio between two sRGB hexes. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('presentation comes from the record', () => {
  it('answers every bed with the same defaults today', () => {
    // Grouping is deliberately not built. What this proves is only that the
    // screens ask, so adding a group later is a new lookup and not an
    // unpicking job across fifty markup files.
    const one = presentationFor(BED);
    const two = presentationFor({ ...BED, plate: 'BED-WH-1712' });
    expect(one.colors).toEqual(two.colors);
    expect(one.logo.src).toBe('/img/trash-talk-nyc-logo.png');
    expect(one.copy.wordmark).toBe('TRASH TALK NYC');
  });

  it('takes the locality off the bed rather than having it typed twice', () => {
    expect(presentationFor(BED).copy.locality).toBe('W 138 ST');
    expect(defaultPresentation().copy.locality).toBe('');
  });

  it('writes the roles out as custom properties, kebab-cased', () => {
    const style = themeStyle(presentationFor(BED).colors);
    expect(style).toContain('--theme-ground:#eae9da');
    expect(style).toContain('--theme-on-clear-muted:');
    expect(themeVar('onAlert')).toBe('var(--theme-on-alert)');
  });
});

describe('every pairing clears WCAG AA', () => {
  const c = presentationFor(BED).colors;

  it('carries black on the yellow, never white', () => {
    // 1.53:1 the other way. The captain's constraint, and the one pairing in
    // the palette that is actually dangerous.
    expect(c.onAlert).toBe(c.ink);
    expect(contrast(c.onAlert, c.alert)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', c.alert)).toBeLessThan(3);
  });

  it('clears 4.5:1 for body text on every ground a screen uses', () => {
    const pairs: Array<[string, string, string]> = [
      ['ink on ground', c.ink, c.ground],
      ['ink on surface', c.ink, c.surface],
      ['muted on ground', c.muted, c.ground],
      ['muted on surface', c.muted, c.surface],
      ['faint on surface', c.faint, c.surface],
      ['faint on ground', c.faint, c.ground],
      ['onClear on clear', c.onClear, c.clear],
      ['onClearMuted on clear', c.onClearMuted, c.clear],
      ['onAction on action', c.onAction, c.action],
      ['action on ground', c.action, c.ground],
      ['clear on ground', c.clear, c.ground],
      ['alertInk on ground', c.alertInk, c.ground],
    ];
    for (const [name, ink, ground] of pairs) {
      expect(contrast(ink, ground), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives every problem tile an ink and an edge that are visible on paper', () => {
    for (const problem of PROBLEMS) {
      expect(contrast(c[problem.ink], c.ground), problem.value).toBeGreaterThanOrEqual(4.5);
      // Borders and other non-text UI only owe 3:1.
      expect(contrast(c[problem.edge], c.ground), problem.value).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('nothing but presentation.ts names a colour', () => {
  // The whole point of the indirection: a hex value anywhere else is a place a
  // future group theme would have to be unpicked from.
  const root = path.resolve(__dirname, '..', 'src');

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  }

  it('finds no hex colour outside the presentation module', () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (file.endsWith('presentation.ts')) continue;
      if (!/\.(astro|css|ts)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const [i, line] of text.split('\n').entries()) {
        // Skips the data: URI the riso grain plate is drawn with, which is an
        // SVG filter and carries no colour of its own.
        if (line.includes('data:image/svg+xml')) continue;
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
