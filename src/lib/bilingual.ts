// The `data-en` / `data-es` attribute pattern, as the sister property
// (trashtalknyc-website) does it, expressed once so no screen writes the
// attribute names by hand.
//
// Every bilingual node carries BOTH languages and renders the active one. Two
// things fall out of that, and both were asked for:
//
//  - The server render is already correct. A visitor with JavaScript disabled —
//    which every form on this site is built to survive (AGENTS.md) — gets the
//    language they chose, and the toggle is a pair of plain links that
//    re-render.
//  - The toggle can then swap the whole screen with no round trip, because
//    every string is already in the document. On a phone at a tree bed on
//    cellular, that is the difference between a toggle and a wait.
//
// The elements these attributes go on must be LEAF nodes: the swap sets
// `textContent`, so a bilingual element with children would lose them. Where a
// sentence wraps something else — the headline wraps the tree type — the
// sentence is split into leaves either side of it, each bilingual in its own
// right.

import type { Lang, Phrase } from './i18n';

/** Attributes for a leaf element whose text is `phrase`. */
export function bi(phrase: Phrase, lang: Lang): Record<string, string> {
  return { 'data-en': phrase.en, 'data-es': phrase.es, 'data-bi': lang };
}

/**
 * Attributes for one bilingual *attribute* — a placeholder, an alt, an
 * aria-label. The active value is set as the attribute itself, so a screen
 * reader with no JavaScript reads the right one.
 */
export function biAttr(name: string, phrase: Phrase, lang: Lang): Record<string, string> {
  return {
    [name]: phrase[lang],
    [`data-en-${name}`]: phrase.en,
    [`data-es-${name}`]: phrase.es,
  };
}
