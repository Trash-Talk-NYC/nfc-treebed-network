import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { AstroCookies } from 'astro';
import {
  DEFAULT_LANG,
  LANGUAGES,
  langLink,
  otherLang,
  readLang,
  resolveLang,
  withLang,
} from '../src/lib/i18n';
import * as COPY from '../src/lib/copy';
import {
  relativeAge,
  sinceLabel,
  slotsAllTakenMessage,
  slotsJustFilledMessage,
} from '../src/lib/format';
import { PROBLEMS } from '../src/lib/problem';

/** Just enough of Astro's cookie API for the two calls i18n makes. */
function cookieJar(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const written: Array<{ name: string; value: string }> = [];
  const jar = {
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => {
      store.set(name, value);
      written.push({ name, value });
    },
  } as unknown as AstroCookies;
  return { jar, written };
}

describe('which language a screen speaks', () => {
  it('takes the visitor’s choice off the URL and remembers it', () => {
    const { jar, written } = cookieJar();
    expect(resolveLang(new URL('https://x/t/abc?lang=es'), jar)).toBe('es');
    expect(written).toEqual([{ name: 'tg_lang', value: 'es' }]);
  });

  it('falls back to the stored choice, then to English', () => {
    const stored = cookieJar({ tg_lang: 'es' });
    expect(resolveLang(new URL('https://x/t/abc'), stored.jar)).toBe('es');
    // Nothing is written when the URL names no language.
    expect(stored.written).toEqual([]);

    const empty = cookieJar();
    expect(resolveLang(new URL('https://x/t/abc'), empty.jar)).toBe(DEFAULT_LANG);
  });

  it('never guesses from the browser, and refuses a value it does not know', () => {
    // The captain asked for a toggle the visitor operates. A phone set to
    // English in a Spanish-speaking household is common on this block, so
    // accept-language would put the wrong plaque in front of exactly the
    // people the Spanish exists for.
    const { jar } = cookieJar({ tg_lang: 'fr' });
    expect(resolveLang(new URL('https://x/t/abc?lang=de'), jar)).toBe('en');
  });

  it('reads without writing, for the POST routes', () => {
    const { jar, written } = cookieJar();
    expect(readLang(new URL('https://x/t/abc?lang=es'), jar)).toBe('es');
    expect(written).toEqual([]);
  });
});

describe('carrying the language along', () => {
  it('keeps everything else the URL was carrying', () => {
    // The tap-suppression flag especially: dropping it would log a second tap
    // every time somebody switched language on a screen we sent them to.
    const url = new URL('https://x/t/abc?tg_action=1&utm_source=popl');
    expect(withLang(url, 'es')).toBe('/t/abc?tg_action=1&utm_source=popl&lang=es');
  });

  it('replaces a language already on the URL rather than appending one', () => {
    expect(withLang(new URL('https://x/t/abc?lang=es'), 'en')).toBe('/t/abc?lang=en');
  });

  it('adds the language to our own links, and leaves English links bare', () => {
    expect(langLink('/t/abc/care', 'es')).toBe('/t/abc/care?lang=es');
    expect(langLink('/t/abc?tg_action=1', 'es')).toBe('/t/abc?tg_action=1&lang=es');
    expect(langLink('/t/abc/care', 'en')).toBe('/t/abc/care');
  });

  it('offers the other language', () => {
    expect(otherLang('en')).toBe('es');
    expect(otherLang('es')).toBe('en');
  });
});

describe('the dictionary', () => {
  // The captain's constraint is that the WHOLE page exists in Spanish, and
  // that an untranslated string is a defect rather than a follow-up. The type
  // system already makes an English-only entry impossible; this is what stops
  // the other way of failing it — a Spanish value that is just the English one
  // copied across, or an empty one.
  const phrases: Array<[string, { en: string; es: string }]> = [];
  for (const [group, entries] of Object.entries(COPY)) {
    for (const [key, phrase] of Object.entries(entries as Record<string, unknown>)) {
      const p = phrase as { en?: unknown; es?: unknown };
      if (typeof p?.en === 'string' && typeof p?.es === 'string') {
        phrases.push([`${group}.${key}`, p as { en: string; es: string }]);
      }
    }
  }

  it('holds every screen’s strings, in both languages', () => {
    expect(phrases.length).toBeGreaterThan(50);
    for (const [name, phrase] of phrases) {
      expect(phrase.en.trim(), name).not.toBe('');
      expect(phrase.es.trim(), name).not.toBe('');
    }
  });

  it('has actually been translated, not copied across', () => {
    // A named few are the same word in both languages and legitimately so:
    // "PIN", "ADMIN", "DEMO" and "NFC" are what a Spanish speaker on this
    // block says too. Everything else differing is what "translated" means,
    // and this is what catches a screen added in English with the Spanish
    // copied across.
    const identical = phrases.filter(([, p]) => p.en === p.es).map(([name]) => name);
    expect(identical).toEqual([
      'AUTH.pin',
      'ADMIN.adminLabel',
      'ADMIN.demoBadge',
      'ADMIN.badgeNfcShort',
    ]);
  });

  it('names all four problem categories in both languages', () => {
    expect(PROBLEMS.map((p) => p.label.en)).toEqual([
      'Thirsty plants',
      'Litter',
      'Guard damage',
      'Something else',
    ]);
    for (const problem of PROBLEMS) {
      expect(problem.label.es.trim()).not.toBe('');
      expect(problem.label.es).not.toBe(problem.label.en);
    }
  });

  it('covers exactly the languages the toggle offers', () => {
    expect([...LANGUAGES]).toEqual(['en', 'es']);
  });
});

// The rendered surface, scanned rather than trusted.
//
// The dictionary check above only walks `copy.ts`, which is exactly why
// English rendered from somewhere else went unnoticed: `relativeAge` and
// `sinceLabel` returned "JUST NOW" and "since May 2026" as bare strings, and
// a bare string is untranslated twice over — the Spanish render shows English,
// and the toggle cannot swap it either, because the swap reads `data-en` /
// `data-es` off a leaf node and a bare text node carries neither.
//
// So two nets, both of which fail CLOSED on something new:
//   1. every `.astro` file's markup, where a word outside an expression is a
//      hardcoded string nobody can translate;
//   2. every `src/lib` module a screen imports, unless it is named below with
//      a reason, where prose in a string literal must be an `en:` / `es:`
//      value — i.e. a `Phrase`.
describe('the rendered surface', () => {
  const SRC = path.resolve(__dirname, '../src');

  function walk(dir: string, ext: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, ext, out);
      else if (full.endsWith(ext)) out.push(full);
    }
    return out;
  }

  const screens = walk(SRC, '.astro');

  /** A screen's markup with its frontmatter, styles, scripts and expressions taken out. */
  function markup(source: string): string {
    let body = source.startsWith('---') ? source.slice(source.indexOf('---', 3) + 3) : source;
    body = body.replace(/<style[^]*?<\/style>/g, ' ').replace(/<script[^]*?<\/script>/g, ' ');
    // Expressions carry the copy; what is left over is literal text. Nested
    // braces come out from the inside, so a map callback goes with them.
    let previous = '';
    while (previous !== body) {
      previous = body;
      body = body.replace(/\{[^{}]*\}/g, ' ');
    }
    return body.replace(/<[^>]*>/g, ' ');
  }

  it('has no hardcoded words in any screen’s markup', () => {
    expect(screens.length).toBeGreaterThan(5);
    for (const screen of screens) {
      const words = markup(readFileSync(screen, 'utf8')).match(/[A-Za-zÀ-ÿ]{2,}/g) ?? [];
      expect([...new Set(words)], path.relative(SRC, screen)).toEqual([]);
    }
  });

  /**
   * Modules screens are allowed to hold English in, each for a stated reason.
   * Anything else a screen imports is scanned, so a new display helper is
   * covered the day it is written rather than the day somebody remembers.
   */
  const ALLOWED = new Map<string, string>([
    // The dictionary itself — every value is a Phrase, and checked above.
    ['copy.ts', 'the Phrase table, held to both languages by the checks above'],
    // What is left there is `wordmark`, a brand name that is deliberately not
    // translated, and `locality`, derived from the bed's cross streets. No
    // rendered sentence lives there any more; anything else added has to argue
    // for itself rather than inherit this exemption.
    ['presentation.ts', 'a brand name, a derived locality, and colour roles — no copy'],
    // Plain-text refusals for machine callers, deliberately English-only
    // (AGENTS.md): nothing renders those to a person.
    ['request-body.ts', 'transport refusals, English-only by decision'],
    ['tag-route.ts', 'transport refusals, English-only by decision'],
    ['admin-route.ts', 'transport refusals, English-only by decision'],
    ['service.ts', 'rule codes and error messages, never rendered'],
    ['store.ts', 'configuration errors, never rendered'],
    ['store-dataset.ts', 'seed data and configuration errors'],
    ['session.ts', 'cookie names and configuration errors'],
    ['tag-bindings.ts', 'the checked-in registry, internal keys'],
    ['tag-id.ts', 'the ID alphabet and its normalization'],
    ['plaque-url.ts', 'query-parameter flags'],
    ['build-target.ts', 'build configuration'],
    ['types.ts', 'field names and derived handles, not copy'],
    ['i18n.ts', 'language codes and the cookie name'],
    ['bilingual.ts', 'the data-attribute names themselves'],
  ]);

  /** Every `src/lib` module any screen imports. */
  function importedHelpers(): string[] {
    const found = new Set<string>();
    for (const screen of screens) {
      const source = readFileSync(screen, 'utf8');
      for (const match of source.matchAll(/from '([^']*\/lib\/[^']+)'/g)) {
        found.add(path.resolve(path.dirname(screen), `${match[1]}.ts`));
      }
    }
    return [...found].filter((file) => !ALLOWED.has(path.basename(file)));
  }

  it('keeps prose out of the helpers screens render through', () => {
    const helpers = importedHelpers();
    // format.ts and problem.ts at least: a helper set that emptied itself
    // would make this test pass by scanning nothing.
    expect(helpers.length).toBeGreaterThan(0);
    for (const helper of helpers) {
      const source = readFileSync(helper, 'utf8')
        // Comments are prose by design.
        .replace(/\/\*[^]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        // A thrown error is a message to whoever is reading a stack trace,
        // never to a visitor: nothing renders one.
        .replace(/new [A-Za-z]*Error\((?:[^()]|\([^()]*\))*\)/g, ' ')
        // Both sides of every Phrase — the one place prose belongs.
        .replace(/\b(en|es):\s*(['"`])(?:\\.|(?!\2)[^\\])*\2/g, ' ');
      const literals = [...source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]!);
      // A BCP-47 locale tag and an IANA zone are machine tokens, and the only
      // capitals in this build that are not a label somebody reads.
      const machineToken = (text: string) =>
        /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})+$/.test(text) || /^[A-Za-z_]+\/[A-Za-z_]+$/.test(text);
      const prose = literals.filter(
        // A space beside a letter is a sentence; a run of capitals is a label.
        (text) =>
          !machineToken(text) &&
          (/[A-Za-z][^\S\n]|[^\S\n][A-Za-z]/.test(text) || /\b[A-Z]{2,}\b/.test(text)),
      );
      expect(prose, `${path.relative(SRC, helper)} must return Phrase values`).toEqual([]);
    }
  });
});

describe('the strings that are formatted rather than looked up', () => {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

  it('gives a report’s age in both languages', () => {
    expect(relativeAge(at(0))).toEqual({ en: 'JUST NOW', es: 'AHORA MISMO' });
    expect(relativeAge(at(35))).toEqual({ en: '35 MIN AGO', es: 'HACE 35 MIN' });
    expect(relativeAge(at(60))).toEqual({ en: '1 HR AGO', es: 'HACE 1 HORA' });
    expect(relativeAge(at(6 * 60))).toEqual({ en: '6 HRS AGO', es: 'HACE 6 HORAS' });
    expect(relativeAge(at(3 * 24 * 60))).toEqual({ en: '3 DAYS AGO', es: 'HACE 3 DÍAS' });
    // A clock that has run backwards is "just now", not a negative age.
    expect(relativeAge(at(-5))).toEqual({ en: 'JUST NOW', es: 'AHORA MISMO' });
  });

  it('counts a bed’s slots rather than assuming two of them', () => {
    // The six W 171st beds hold one slot, so "Both slots are taken" is false
    // on the captain's own block — in both languages.
    expect(slotsAllTakenMessage(1).en).toContain('The only slot is taken.');
    expect(slotsAllTakenMessage(1).es).toContain('El único lugar está ocupado.');
    expect(slotsAllTakenMessage(2).en).toContain('Both slots are taken.');
    expect(slotsAllTakenMessage(3).es).toContain('Los 3 lugares están ocupados.');
    expect(slotsJustFilledMessage(1).en).toContain('The only slot just filled up.');
    expect(slotsJustFilledMessage(2).es).toContain('Los dos lugares se acaban de ocupar.');
    expect(slotsJustFilledMessage(4).en).toContain('All 4 slots just filled up.');
    for (const slots of [1, 2, 3]) {
      for (const phrase of [slotsAllTakenMessage(slots), slotsJustFilledMessage(slots)]) {
        expect(phrase.es).not.toBe(phrase.en);
      }
    }
  });

  it('names the month a steward started in, in their own language', () => {
    const since = sinceLabel(new Date('2026-05-02T14:00:00.000Z'));
    expect(since.en).toBe('since May 2026');
    expect(since.es).toBe('desde mayo de 2026');
  });
});
