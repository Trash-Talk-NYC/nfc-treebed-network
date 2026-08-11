// Display formatting. All street-facing times are America/New_York — the
// beds are physically in Harlem; the server's zone is irrelevant.

const NY = 'America/New_York';

/** YYYY-MM-DD in NY time; the unit of the one-report-per-day rule. */
export function nyCalendarDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Receipt timestamp, e.g. "15:41 · MON AUG 11". */
export function receiptTime(date: Date): string {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
    .format(date)
    .toUpperCase()
    .replace(/,/g, '');
  return `${time} · ${day}`;
}

/** Relative age for report bands, e.g. "JUST NOW", "35 MIN AGO", "6 HRS AGO". */
export function relativeAge(from: Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (mins < 2) return 'JUST NOW';
  if (mins < 60) return `${mins} MIN AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} ${hrs === 1 ? 'HR' : 'HRS'} AGO`;
  return `${Math.floor(hrs / 24)} DAYS AGO`;
}

/** Adopter chip suffix, e.g. "since May 2026". */
export function sinceLabel(date: Date): string {
  return `since ${new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', year: 'numeric' }).format(date)}`;
}
