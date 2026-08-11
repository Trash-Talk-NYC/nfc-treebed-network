import { describe, expect, it } from 'vitest';
import { severityFrom, severityFromIndex, severityIndexFrom, severityName } from '../src/lib/severity';

describe('severity parsing', () => {
  it('reads the three tiers a form can name', () => {
    expect(severityFrom('0')).toBe('light');
    expect(severityFrom('1')).toBe('heavy');
    expect(severityFrom('2')).toBe('dumping');
    expect(severityIndexFrom(' 2 ')).toBe(2);
  });

  it('refuses a value nobody picked instead of falling back to LIGHT', () => {
    // Number(null) and Number('') are both 0 — the trap this guards.
    for (const raw of [null, undefined, '', '  ', 'light', '1.5', '-1', '3', '0x0', 42]) {
      expect(severityFrom(raw)).toBeNull();
      expect(severityIndexFrom(raw)).toBeNull();
    }
  });

  it('names each tier with the prototype copy', () => {
    expect(severityName('dumping')).toBe('DUMPING');
    expect(severityFromIndex(3)).toBeNull();
  });
});
