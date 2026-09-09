import { describe, expect, it } from 'vitest';
import { isPostAction, ourPlaqueLink } from '../src/lib/plaque-url';

const BASE = '/t/2mq2amhv';
const url = (path: string): URL => new URL(path, 'https://plaque.test');

describe('telling our own redirects from a tap', () => {
  it('counts a bare tap', () => {
    expect(isPostAction(url(BASE))).toBe(false);
  });

  it('counts a tap whose URL somebody decorated', () => {
    // A tag URL arrives with UTM tags, Popl parameters, whatever a shortener
    // appends. Every one of those is still a person at the tree bed.
    expect(isPostAction(url(`${BASE}?utm_source=popl&utm_medium=nfc`))).toBe(false);
    expect(isPostAction(url(`${BASE}?fbclid=abc123`))).toBe(false);
    expect(isPostAction(url(`${BASE}?done=1&from=somewhere`))).toBe(false);
  });

  it('counts a tap carrying a readable word an Option A screen once used', () => {
    // Those routes went with Option A, and the words are ones any link
    // decoration could set. Nothing of ours produces them any more.
    expect(isPostAction(url(`${BASE}?confirmed=1`))).toBe(false);
    expect(isPostAction(url(`${BASE}?raised=1`))).toBe(false);
    expect(isPostAction(url(`${BASE}?limited=1`))).toBe(false);
  });

  it('does not count the redirects with nothing to flash', () => {
    // The report someone else already filed, a second applause the same day,
    // the link back from the thank-you: one visit, one tap.
    expect(isPostAction(url(ourPlaqueLink(BASE)))).toBe(true);
    expect(isPostAction(url(`${ourPlaqueLink(BASE)}&utm_source=popl`))).toBe(true);
  });
});
