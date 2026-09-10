// Which language a screen is rendered in, and how a visitor changes it.
//
// The captain asked for a toggle the visitor operates, explicitly NOT a
// browser-language guess: Washington Heights is heavily Spanish-speaking, and
// a phone set to English in a Spanish-speaking household is common enough that
// sniffing `accept-language` would put the wrong plaque in front of exactly the
// people this exists for. So nothing here reads the header.
//
// The choice is resolved server-side, in this order:
//   1. `?lang=` on the URL — what the toggle link carries, so the toggle works
//      with JavaScript disabled. Every form is a plain HTML POST on this site
//      (AGENTS.md) and the language control is held to the same standard.
//   2. the `tg_lang` cookie — set whenever (1) names a language, so the choice
//      survives the next tap on the next bed.
//   3. English.
//
// The cookie is deliberately NOT signed, unlike `tg_session`/`tg_visitor`: it
// carries no identity and grants nothing, and an unparseable value falls back
// to English rather than failing. Signing it would only add a secret to a
// preference.
//
// Sister-property parity: trashtalknyc-website renders both languages into
// `data-en` / `data-es` attributes and swaps them in the browser. Screens here
// emit the same attributes (`src/lib/bilingual.ts`, with the control in
// `src/components/LangToggle.astro`), so the instant, no-reload swap works the
// same way — the server render is what makes it
// correct before any script has run, and what makes it correct with no script
// at all.

import type { AstroCookies } from 'astro';

export const LANGUAGES = ['en', 'es'] as const;
export type Lang = (typeof LANGUAGES)[number];

export const DEFAULT_LANG: Lang = 'en';

/** A string in both languages. Every visitor-facing string is one of these. */
export interface Phrase {
  en: string;
  es: string;
}

const LANG_COOKIE = 'tg_lang';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The query parameter the toggle link carries. */
export const LANG_PARAM = 'lang';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * The language this render speaks, taking the visitor's choice from the URL
 * when it carries one and persisting it.
 *
 * Called once per screen, before anything is rendered. Screens that never set
 * a cookie (the POST routes) can pass `cookies` all the same — nothing is
 * written unless the URL actually names a language.
 */
export function resolveLang(url: URL, cookies: AstroCookies): Lang {
  const asked = url.searchParams.get(LANG_PARAM);
  if (isLang(asked)) {
    cookies.set(LANG_COOKIE, asked, {
      path: '/',
      sameSite: 'lax',
      maxAge: YEAR_SECONDS,
      // A preference, not an identity: readable by the client-side toggle so a
      // no-reload swap can persist without a round trip.
      httpOnly: false,
    });
    return asked;
  }
  const stored = cookies.get(LANG_COOKIE)?.value;
  return isLang(stored) ? stored : DEFAULT_LANG;
}

/** The language a POST route should answer in — read-only, never written. */
export function readLang(url: URL, cookies: AstroCookies): Lang {
  const asked = url.searchParams.get(LANG_PARAM);
  if (isLang(asked)) return asked;
  const stored = cookies.get(LANG_COOKIE)?.value;
  return isLang(stored) ? stored : DEFAULT_LANG;
}

/** The other language — what the toggle offers. */
export function otherLang(lang: Lang): Lang {
  return lang === 'en' ? 'es' : 'en';
}

/** One phrase in one language. */
export function t(phrase: Phrase, lang: Lang): string {
  return phrase[lang];
}

/**
 * A URL with `?lang=` set to `lang`, everything else left alone.
 *
 * Used by the toggle, which has to preserve whatever else the URL carries: a
 * decorated tag URL's UTM tags, the too-large screen's `reason`, and — the one
 * that would otherwise cost a number the field test is measured on — the
 * plaque's own `tg_action` flag, without which switching language on a screen
 * we sent someone to would log a second tap (`plaque-url.ts`).
 */
export function withLang(url: URL, lang: Lang): string {
  const next = new URL(url);
  next.searchParams.set(LANG_PARAM, lang);
  return `${next.pathname}${next.search}`;
}

/**
 * Carry the current language onto a link or redirect of ours.
 *
 * The cookie already carries it, so this is belt-and-braces for the one case
 * the cookie cannot cover: a visitor whose browser refuses cookies still gets
 * the language they picked for the rest of the flow, because every link we
 * build passes it along.
 */
export function langLink(href: string, lang: Lang): string {
  if (lang === DEFAULT_LANG) return href;
  const [path, query] = href.split('?', 2);
  const params = new URLSearchParams(query ?? '');
  params.set(LANG_PARAM, lang);
  return `${path}?${params.toString()}`;
}
