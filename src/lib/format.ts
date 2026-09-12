// Display formatting. All street-facing times are America/New_York — the
// beds are physically in Harlem; the server's zone is irrelevant.
//
// Everything a visitor or a steward reads comes back as a `Phrase`, for the
// same reason the copy table does (design-record.md, constraint 11): a
// helper that returned an English string would be an untranslated string on a
// bilingual screen, and one the toggle could not swap either — the swap sets
// `textContent` off `data-en`/`data-es`, which a bare text node has not got.

import type { Phrase } from './i18n';
import { LANGUAGES } from './i18n';

const NY = 'America/New_York';

/** The Intl locale each language formats dates in. */
const LOCALE: Record<(typeof LANGUAGES)[number], string> = { en: 'en-US', es: 'es-ES' };

/** YYYY-MM-DD in NY time; the unit of the one-report-per-day rule. */
export function nyCalendarDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Relative age for report bands, e.g. "35 MIN AGO" / "HACE 35 MIN". */
export function relativeAge(from: Date, now: Date = new Date()): Phrase {
  const mins = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (mins < 2) return { en: 'JUST NOW', es: 'AHORA MISMO' };
  if (mins < 60) return { en: `${mins} MIN AGO`, es: `HACE ${mins} MIN` };
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) {
    return {
      en: `${hrs} ${hrs === 1 ? 'HR' : 'HRS'} AGO`,
      es: `HACE ${hrs} ${hrs === 1 ? 'HORA' : 'HORAS'}`,
    };
  }
  const days = Math.floor(hrs / 24);
  return { en: `${days} DAYS AGO`, es: `HACE ${days} DÍAS` };
}

/** The block list's count line, e.g. "6 tree beds" / "6 canteros". */
export function bedCountLabel(count: number): Phrase {
  return {
    en: `${count} ${count === 1 ? 'tree bed' : 'tree beds'}`,
    es: `${count} ${count === 1 ? 'cantero' : 'canteros'}`,
  };
}

/** The admin bed panel's slots heading, e.g. "Slots · 1 of 2 filled". */
export function slotsFilledLabel(filled: number, total: number): Phrase {
  return {
    en: `Slots · ${filled} of ${total} filled`,
    es: `Lugares · ${filled} de ${total} ocupados`,
  };
}

/** The admin panel's line for when a report was opened, e.g. "Opened Sep 11, 3:42 PM". */
export function openedLabel(date: Date): Phrase {
  const when = (lang: (typeof LANGUAGES)[number]): string =>
    new Intl.DateTimeFormat(LOCALE[lang], {
      timeZone: NY,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  return { en: `Opened ${when('en')}`, es: `Abierto el ${when('es')}` };
}

/** How many neighbours added their weight to an open report (`Report.confirmedBy`). */
export function confirmationsLabel(count: number): Phrase {
  if (count <= 0) {
    return { en: 'No one else has reported it yet', es: 'Nadie más lo ha reportado todavía' };
  }
  if (count === 1) return { en: '1 neighbour also reported it', es: '1 vecino más lo reportó' };
  return { en: `${count} neighbours also reported it`, es: `${count} vecinos más lo reportaron` };
}

/** Steward chip suffix, e.g. "since May 2026" / "desde mayo de 2026". */
export function sinceLabel(date: Date): Phrase {
  // Intl carries the month name in each language, so nothing here holds a
  // table of month names to fall out of date or to be half-translated.
  const month = (lang: (typeof LANGUAGES)[number]): string =>
    new Intl.DateTimeFormat(LOCALE[lang], {
      timeZone: NY,
      month: lang === 'en' ? 'short' : 'long',
      year: 'numeric',
    }).format(date);
  return { en: `since ${month('en')}`, es: `desde ${month('es')}` };
}

/**
 * "Both slots are taken." — how many slots a bed has is data, not a constant:
 * the six W 171st beds hold one, the demo bed holds two, and a sentence that
 * names two is false on the captain's own block.
 */
function slotsTakenClause(slots: number): Phrase {
  if (slots <= 1) return { en: 'The only slot is taken.', es: 'El único lugar está ocupado.' };
  if (slots === 2) return { en: 'Both slots are taken.', es: 'Los dos lugares están ocupados.' };
  return { en: `All ${slots} slots are taken.`, es: `Los ${slots} lugares están ocupados.` };
}

/** The same count, as the thing that just happened while the form was open. */
function slotsJustFilledClause(slots: number): Phrase {
  if (slots <= 1) {
    return { en: 'The only slot just filled up.', es: 'El único lugar se acaba de ocupar.' };
  }
  if (slots === 2) {
    return { en: 'Both slots just filled up.', es: 'Los dos lugares se acaban de ocupar.' };
  }
  return {
    en: `All ${slots} slots just filled up.`,
    es: `Los ${slots} lugares se acaban de ocupar.`,
  };
}

/** The adopt screen's refusal for a bed whose slots were already all taken. */
export function slotsAllTakenMessage(slots: number): Phrase {
  const clause = slotsTakenClause(slots);
  return {
    en: `${clause.en} This bed has the people it needs — but others on the block are still waiting.`,
    es: `${clause.es} Este cantero ya tiene quien lo cuide, pero otros de la cuadra siguen esperando.`,
  };
}

/** The adopt screen's refusal for a slot lost between the render and the POST. */
export function slotsJustFilledMessage(slots: number): Phrase {
  const clause = slotsJustFilledClause(slots);
  return {
    en: `${clause.en} This bed has the people it needs.`,
    es: `${clause.es} Este cantero ya tiene quien lo cuide.`,
  };
}

/**
 * First letter uppercased, for a value stored in the casing its commonest
 * use needs. `Bed.treeType.es` is stored lowercase because the door frame
 * puts it mid-sentence ("El cantero de este roble sauce…"); the steward
 * heading and the admin bed labels print it standalone, where a lowercase
 * initial reads as a mistake. Code-point aware, so "árbol" → "Árbol".
 */
export function capitalizeFirst(text: string): string {
  const [first, ...rest] = [...text];
  return first === undefined ? text : first.toUpperCase() + rest.join('');
}
