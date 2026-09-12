import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defaultPresentation, presentationFor, themeStyle, themeVar } from '../src/lib/presentation';
import { PROBLEMS } from '../src/lib/problem';
import type { Bed } from '../src/lib/types';

/** Every file under a directory, recursively. */
function walkFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

const BED: Bed = {
  plate: 'BED-HRL-0847',
  plantingSpaceId: '15850293',
  plantingSpaceGlobalId: null,
  treeType: { en: 'willow oak', es: 'roble sauce' },
  treeId: '08-4211',
  bedName: null,
  tagUid: '04:A2:2F:9C',
  crossStreets: 'W 138 St × Adam Clayton Powell Jr Blvd',
  address: '2300 Adam Clayton Powell Jr Blvd, New York, NY 10030',
  slots: 2,
  offeredSlots: 2,
  guard: 'none',
  treePresent: true,
  plantsPresent: false,
  plantsNote: '',
  plantingRecommended: false,
  recommendedPlantsNote: '',
  careNote: '',
  blockId: null,
  blockPosition: null,
  applauseNoticeAt: null,
  applauseNoticeDueAt: null,
  nycSyncedAt: null,
  nycMissingSince: null,
  retiredAt: null,
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

  it('writes them onto the root element, which is where :root can read them', () => {
    // A custom property holding a `var()` is substituted on the element it is
    // declared on. global.css declares the default `--ink-*` set — and the
    // html/body grounds — on `:root`, so the roles have to arrive there: one
    // element lower and every one of those computes to the guaranteed-invalid
    // value and silently falls back to the inherited ink.
    for (const layout of ['Screen.astro', 'AdminScreen.astro']) {
      const text = readFileSync(path.resolve(__dirname, '..', 'src', 'layouts', layout), 'utf8');
      expect(text, layout).toMatch(/<html[^>]*style=\{themeStyle\(/);
      expect(text, layout).not.toMatch(/<body[^>]*style=\{themeStyle\(/);
    }
  });
});

describe('every pairing clears WCAG AA', () => {
  const c = presentationFor(BED).colors;

  // The innermost rules of the stylesheet — the body pattern excludes braces,
  // so an at-rule's prelude is skipped rather than swallowing what it wraps.
  const css = readFileSync(path.resolve(__dirname, '..', 'src', 'styles', 'global.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim().replace(/\s+/g, ' '),
    body: match[2]!,
  }));
  const clearRules = rules.filter((rule) => rule.selector.includes('.screen-clear'));
  /** The light fills that hand their subtree the surface ink set back. */
  const CONTAINER = /^\.card, \.box, \.band-clear$/;

  /** A `--theme-*` name off the stylesheet, resolved to the colour it holds. */
  const role = (name: string | undefined): string | undefined => {
    if (name === undefined) return undefined;
    const key = name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase()) as keyof typeof c;
    return c[key];
  };

  /** The ink set the clear ground hands down, by variable name. */
  const clearInks = new Map(
    [
      ...(rules.find((r) => /^\.ground-clear, \.screen-clear$/.test(r.selector))?.body ?? '')
        .matchAll(/(--ink-[a-z-]+):\s*var\(--theme-([a-z-]+)\)/g),
    ].map((match) => [match[1]!, role(match[2])!]),
  );

  /**
   * A `var(--theme-*)` or `var(--ink-*)` reference on the clear ground,
   * resolved to the colour it paints there — the inks travel as inherited
   * variables now, so a rule may legitimately name either.
   */
  const onClearVar = (decl: string | undefined): string | undefined => {
    const name = /var\(--((?:theme|ink)-[a-z-]+)\)/.exec(decl ?? '')?.[1];
    if (name === undefined) return undefined;
    return name.startsWith('ink-') ? clearInks.get(`--${name}`) : role(name.slice('theme-'.length));
  };

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

  it('keeps the attention fill visible on the green the tap flow stands on', () => {
    // Since the 2026-09-11 reversal the page ground is the green: the report
    // band and the error chip are yellow FILLS on it, which owe 3:1 as UI —
    // the text on them is the black (10.97:1), never the green underneath.
    expect(contrast(c.alert, c.clear)).toBeGreaterThanOrEqual(3);
    // And the beige containers and tiles must stand off the green too.
    expect(contrast(c.ground, c.clear)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the purple off the green, focus edge included', () => {
    // 1.36:1 — the purple is an action on the beige and nothing at all on the
    // green, which is why the error moved to the yellow chip. The focused
    // field edge owes the same, so the stylesheet is read rather than trusted:
    // the rule that runs on the clear ground must name a role that clears the
    // 3:1 a border owes there, and no rule scoped to that ground may reach for
    // the action at all.
    expect(contrast(c.action, c.clear)).toBeLessThan(3);

    const focus = clearRules.find((rule) => /\.field-input:focus(?!-)/.test(rule.selector));
    expect(focus, 'no .screen-clear field-focus rule').toBeDefined();
    const focusBorder = onClearVar(/border-color:[^;]*/.exec(focus!.body)?.[0]);
    expect(focusBorder, focus!.body).toBeTruthy();
    expect(contrast(focusBorder!, c.clear), 'focused edge on the green').toBeGreaterThanOrEqual(3);

    expect(
      clearRules.filter((rule) => rule.body.includes('--theme-action')).map((r) => r.selector),
    ).toEqual([]);
  });

  it('makes focus a state CHANGE on the green, not just a visible edge', () => {
    // A swap between two roles a person cannot tell apart is a focus
    // indicator in name only — the yellow edge and the resting one are 1.19:1
    // of each other. So what is measured here is the DIFFERENCE the eye has to
    // catch: either the edge itself moves 3:1, or a ring appears that clears
    // 3:1 against the ground it is drawn on.
    const resting = rules.find((rule) => /^\.field-input,\s*\.freetext$/.test(rule.selector));
    expect(resting, 'no resting .field-input rule').toBeDefined();
    const restingBorder = role(/border:[^;]*var\(--theme-([a-z-]+)\)/.exec(resting!.body)?.[1]);
    expect(restingBorder, resting!.body).toBeTruthy();

    const focus = clearRules.find((rule) => /\.field-input:focus(?!-)/.test(rule.selector));
    const focusBorder = onClearVar(/border-color:[^;]*/.exec(focus!.body)?.[0])!;
    // The ring is the keyboard affordance and lives on its own rule: a thumb
    // tap gets the tint, a keyboard gets the ring, the same way the tiles do.
    const ringRule = clearRules.find((rule) => /\.field-input:focus-visible/.test(rule.selector));
    expect(ringRule, 'no .screen-clear field focus-visible rule').toBeDefined();
    expect(focus!.body, 'the tint rule draws the ring, so a tap gets it too').not.toMatch(
      /outline:/,
    );
    const ring = onClearVar(/outline:[^;]*/.exec(ringRule!.body)?.[0]);

    const change = Math.max(
      contrast(focusBorder, restingBorder!),
      ring ? contrast(ring, c.clear) : 1,
    );
    expect(change, focus!.body).toBeGreaterThanOrEqual(3);
    // A ring the base rule turned off is no ring at all.
    expect(ring, ringRule!.body).toBeTruthy();
    expect(ringRule!.body).toMatch(/outline-offset:/);
  });

  it('draws the tile focus ring in the same tone as the field one', () => {
    // The tile ring sits at `outline-offset`, so it is drawn on the page
    // ground rather than on the tile's paper. The black that clears 16:1 on
    // the beige is 3.02:1 on the green — margin a rounding would eat — and two
    // focus indicators on one screen must not read as different states, so the
    // clear ground re-colours the ring to the tone the field ring uses.
    const base = rules.find((rule) => /^\.quad-input:focus-visible \+ \.quad$/.test(rule.selector));
    expect(base, 'no tile focus rule').toBeDefined();
    expect(base!.body, 'a ring with no offset is drawn on the tile').toMatch(/outline-offset:/);

    const override = clearRules.find((rule) => /\.quad-input:focus-visible/.test(rule.selector));
    expect(override, 'no .screen-clear tile focus rule').toBeDefined();
    const ring = onClearVar(/outline(?:-color)?:[^;]*/.exec(override!.body)?.[0]);
    expect(ring, override!.body).toBeTruthy();
    expect(contrast(ring!, c.clear), 'tile ring on the green').toBeGreaterThanOrEqual(3);

    const field = clearRules.find((rule) => /\.field-input:focus-visible/.test(rule.selector));
    const fieldRing = onClearVar(/outline:[^;]*/.exec(field!.body)?.[0]);
    expect(ring, 'the two focus rings on one screen').toBe(fieldRing);
    // Both ride the inherited set, so a field or a tile inside a light
    // container draws the container's tone rather than the ground's.
    for (const rule of [override!, field!]) {
      expect(rule.body, rule.selector).toMatch(/var\(--ink-[a-z-]+\)/);
    }
  });

  it('makes the attached photo an affirmative FILL, not an ink swap', () => {
    // On the green the affirmative ink is the same beige as the body ink, so
    // an ink-only "attached" state is a colour change nobody can see. The
    // confirmation inverts the pill instead — beige paper, green ink, the
    // `band-clear` vocabulary — so idle and attached differ by the whole
    // surface and not by a tone.
    const fills = (selector: RegExp): Map<string, string> => {
      const rule = rules.find((r) => selector.test(r.selector));
      expect(rule, `no rule matching ${selector}`).toBeDefined();
      return new Map(
        [...rule!.body.matchAll(/(--(?:on-)?fill-[a-z-]+):\s*var\(--theme-([a-z-]+)\)/g)].map(
          (match) => [match[1]!, role(match[2])!],
        ),
      );
    };
    const onGreen = fills(/^\.ground-clear, \.screen-clear$/);
    const inContainer = fills(CONTAINER);
    expect([...onGreen.keys()].sort(), 'the affirmative fill pair').toEqual([
      '--fill-affirm',
      '--on-fill-affirm',
    ]);
    expect([...fills(/^:root$/).keys()].sort()).toEqual([...onGreen.keys()].sort());

    for (const [scope, set, paper] of [
      ['on the green', onGreen, c.clear],
      ['inside a container', inContainer, c.surface],
    ] as const) {
      const fill = set.get('--fill-affirm')!;
      const ink = set.get('--on-fill-affirm')!;
      // The pill has to stand off the paper it is drawn on, and carry words.
      expect(contrast(fill, paper), `affirm fill ${scope}`).toBeGreaterThanOrEqual(3);
      expect(contrast(ink, fill), `affirm ink ${scope}`).toBeGreaterThanOrEqual(4.5);
    }

    const resting = rules.find((rule) => /^\.photo-row$/.test(rule.selector));
    expect(resting, 'no resting .photo-row rule').toBeDefined();
    const restingInk = onClearVar(/(^|[;\s])color:[^;]*/.exec(resting!.body)?.[0])!;
    expect(restingInk, resting!.body).toBeTruthy();
    expect(resting!.body, 'the resting pill is the ground itself').not.toMatch(/background:/);

    const attached = rules.find((rule) => /^\.photo-row\.attached$/.test(rule.selector));
    expect(attached, 'no .photo-row.attached rule').toBeDefined();
    expect(attached!.body, 'an ink-only attached state is invisible on the green').toMatch(
      /background:\s*var\(--fill-affirm\)/,
    );
    // What the eye has to catch: the confirmed pill against the ground the
    // idle one dissolves into, and its ink against the ink it replaces.
    const fill = onGreen.get('--fill-affirm')!;
    expect(contrast(fill, c.clear), 'attached pill against the green').toBeGreaterThanOrEqual(3);
    expect(
      contrast(onGreen.get('--on-fill-affirm')!, restingInk),
      'attached label against the idle one',
    ).toBeGreaterThanOrEqual(3);
  });

  it('gives every visually hidden input a focus partner that can be seen', () => {
    // A control hidden in a 1px transparent box still takes keyboard focus,
    // and the browser's own ring is then drawn on that box — invisible. Each
    // one needs a partner element to carry the ring, so the stylesheet is
    // swept for the pattern rather than the two known cases being listed: a
    // third hidden input added later fails here instead of on the street.
    const hidden = rules.filter(
      (rule) =>
        /position:\s*absolute/.test(rule.body) &&
        /width:\s*1px/.test(rule.body) &&
        /opacity:\s*0\s*[;}]?/.test(rule.body),
    );
    const wrappers: Record<string, string> = {
      '.photo-input': '.photo-field',
      '.quad-input': '.catgrid',
    };
    expect(hidden.map((rule) => rule.selector).sort()).toEqual(Object.keys(wrappers).sort());

    const field = clearRules.find((rule) => /\.field-input:focus-visible/.test(rule.selector));
    const fieldRing = onClearVar(/outline:[^;]*/.exec(field!.body)?.[0]);

    for (const rule of hidden) {
      const tokens = rule.selector.split(/\s+/);
      const matches = (candidate: { selector: string }) =>
        candidate.selector.includes(':focus-visible') &&
        tokens.every((token) => candidate.selector.includes(token));

      const ring = rules.find(
        (candidate) => matches(candidate) && /outline:\s*\d+px/.test(candidate.body),
      );
      expect(ring, `no focus ring for ${rule.selector}`).toBeDefined();
      // An affordance whose whole job is to exist must not be dropped
      // wholesale by a browser that cannot parse its selector: the partner is
      // an adjacent sibling, the way the tiles have always done it.
      expect(ring!.selector, 'the ring rests on `:has()`').not.toMatch(/:has\(/);
      // Drawn past the control's own edge, so it lands on the page ground
      // rather than on whatever fill the control carries when it is active.
      expect(ring!.body, ring!.selector).toMatch(/outline-offset:/);

      // The tone that actually paints on the green: the clear ground may
      // re-colour the base ring, as the tiles do.
      const override = clearRules.find(matches);
      const tone = onClearVar(
        (override && /outline(?:-color)?:[^;]*/.exec(override.body)?.[0]) ??
          /outline:[^;]*/.exec(ring!.body)![0],
      );
      expect(tone, ring!.selector).toBeTruthy();
      expect(contrast(tone!, c.clear), `${rule.selector} ring on the green`).toBeGreaterThanOrEqual(
        3,
      );
      // One tone for every focus indicator on the flow, and all of them ride
      // the inherited set so a container reset reaches them too.
      expect(tone, `${rule.selector} ring against the field ring`).toBe(fieldRing);
      expect((override ?? ring)!.body, (override ?? ring)!.selector).toMatch(/var\(--ink-[a-z-]+\)/);

      // A ring the visitor cannot see is one failure; a ring on the control
      // they are looking at while the page scrolls somewhere else is another.
      // An absolutely positioned control takes its static position from its
      // parent, so each hidden input is wrapped in a positioned block of its
      // own rather than left as a child of the screen's flex or grid.
      const wrapper = wrappers[rule.selector];
      expect(wrapper, `no documented wrapper for ${rule.selector}`).toBeTruthy();
      const holder = rules.find((candidate) => candidate.selector === wrapper);
      expect(holder, `no ${wrapper} rule`).toBeDefined();
      expect(holder!.body, `${wrapper} does not hold ${rule.selector}`).toMatch(
        /position:\s*relative/,
      );
    }
  });

  it('hands a light container the whole ink set back, not a rescued list', () => {
    // The green ground's inks travel as inherited `--ink-*` variables so a
    // card or a box resets them once for everything inside it. A descendant
    // override is more specific than inheritance, so the old per-element list
    // meant the next element added inside a container rendered the green's
    // beige ink on near-white paper at about 1.15:1 with nothing to catch it.
    const inks = (selector: RegExp): Map<string, string> => {
      const rule = rules.find((r) => selector.test(r.selector));
      expect(rule, `no rule matching ${selector}`).toBeDefined();
      return new Map(
        [...rule!.body.matchAll(/(--ink-[a-z-]+):\s*var\(--theme-([a-z-]+)\)/g)].map(
          (match) => [match[1]!, role(match[2])!],
        ),
      );
    };
    const defaults = inks(/^:root$/);
    const onGreen = inks(/^\.ground-clear, \.screen-clear$/);
    // Every light fill the flow draws on the green is its own paper and owes
    // the whole set back, the report band included — not just the two the
    // refactor started with.
    const containers = [
      ['a card, a box or the all-clear band', inks(CONTAINER), [c.surface, c.ground, c.onClear]],
      ['the report band', inks(/^\.band-alert$/), [c.alert]],
    ] as const;
    expect(onGreen.size, 'the clear ground defines no ink set').toBeGreaterThan(0);
    // The default set has to be declared where the `--theme-*` roles actually
    // resolve, or every `var()` in it computes to the guaranteed-invalid value
    // and the admin's labels and notes fall back to the inherited ink. The
    // roles are written onto the root element, so `:root` is that place, and
    // it has to carry the same names the two scopes below override.
    expect([...defaults.keys()].sort(), 'the default ink set').toEqual([...onGreen.keys()].sort());

    // The ones that carry words owe body contrast on every paper they reach;
    // the rest (edges, the affirmative tone) are UI and owe 3:1 on the ground
    // they are drawn on.
    const textInks = new Set(['--ink-strong', '--ink-quiet', '--ink-faint']);
    for (const [name, ink] of onGreen) {
      expect(contrast(ink, c.clear), `${name} on the green`).toBeGreaterThanOrEqual(
        textInks.has(name) ? 4.5 : 3,
      );
      for (const [where, set, papers] of containers) {
        const reset = set.get(name);
        expect(reset, `${name} is not reset inside ${where}`).toBeTruthy();
        expect(reset, `${name} keeps the green ground's value inside ${where}`).not.toBe(ink);
        if (!textInks.has(name)) continue;
        // A card is the surface, a box and the all-clear band the beige paper,
        // the report band the yellow; words sit on every one of them.
        for (const paper of papers) {
          expect(contrast(reset!, paper), `${name} on ${where} (${paper})`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
    }

    // And the list must not grow back: nothing scoped to the clear ground may
    // paint a descendant with an on-clear ink, because a container cannot
    // out-specify it.
    expect(
      clearRules
        .filter((rule) => rule.selector !== '.screen-clear')
        .filter((rule) => /(^|[^-])color:\s*var\(--theme-on-clear/.test(rule.body))
        .map((rule) => rule.selector),
    ).toEqual([]);
  });

  it('keeps scoped styles off the green ground\'s own inks', () => {
    // The container reset can only rescue what travels as `--ink-*`. A scoped
    // <style> naming `--theme-on-clear*` (or the surface ink roles) for text
    // is the same per-element list in another file, where the rule above
    // cannot see it — and it is exactly what renders at ~1.15:1 the day that
    // element moves inside a `.card` or a `.box`. Every `.astro` file is read,
    // components and layouts included: the language toggle stands on the green
    // too, and it is the one that a `src/pages` sweep could not see.
    const pages = path.resolve(__dirname, '..', 'src');
    const offenders: string[] = [];
    for (const file of walkFiles(pages)) {
      if (!file.endsWith('.astro')) continue;
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [i, line] of text.split('\n').entries()) {
        if (/(^|[;{\s])color:\s*var\(--theme-(ink|muted|faint|border|on-clear)/.test(line)) {
          offenders.push(`${path.relative(pages, file)}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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

  it('finds no hex colour outside the presentation module', () => {
    const offenders: string[] = [];
    for (const file of walkFiles(root)) {
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
