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
