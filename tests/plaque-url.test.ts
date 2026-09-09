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

  it('does not count the redirects that flash something', () => {
    expect(isPostAction(url(`${BASE}?confirmed=1`))).toBe(true);
    expect(isPostAction(url(`${BASE}?raised=1`))).toBe(true);
    expect(isPostAction(url(`${BASE}?limited=1`))).toBe(true);
  });

  it('does not count the redirects with nothing to flash either', () => {
    // The report someone else already filed, a confirm on a report that has
    // since been closed, an anonymous clear: one visit, one tap.
    expect(isPostAction(url(ourPlaqueLink(BASE)))).toBe(true);
    expect(isPostAction(url(`${ourPlaqueLink(BASE)}&utm_source=popl`))).toBe(true);
  });
});
