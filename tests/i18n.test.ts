import { describe, expect, it } from 'vitest';
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
    // "PIN" is the same word in both, and is the only entry that legitimately
    // is. Everything else differing is what "translated" means, and this is
    // what catches a screen added in English with the Spanish copied across.
    const identical = phrases.filter(([, p]) => p.en === p.es).map(([name]) => name);
    expect(identical).toEqual(['ADOPT.pin']);
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
