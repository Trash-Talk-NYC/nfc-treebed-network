// What every /t/<tag> sub-page hands a visitor when the tag or its bed is
// gone — and, load-bearing, what that answer is allowed to carry.
//
// The sign-in link's token is a live credential until the POST behind the
// interstitial burns it, so a redirect that forwarded the query string
// verbatim would put it in a `location` header (what platform access logs
// keep) and then in the door screen's address bar, whose language-toggle
// links are built from the URL it arrived on. Both hops out of a sub-page
// live in tag-route.ts, so both are pinned here — and so is the helper the
// two redirects OUTSIDE this file answer the same question with, because a
// rule kept at two of four call sites is not a rule.

import { describe, expect, it } from 'vitest';
import {
  forwardableSearch,
  refuseMissingBedScreen,
  requireBoundTagForForm,
} from '../src/lib/tag-route';

/** The seeded demo tag (tag-bindings.ts). */
const TAG = '2mq2amhv';
/** Well-formed, and bound to nothing. */
const UNBOUND_TAG = '2mq2amhz';
const TOKEN = 'a-live-sign-in-token';

describe('the hop out of a sub-page whose bed has gone', () => {
  it('carries the language and drops the sign-in token', async () => {
    const request = new Request(
      `https://trashtalknyc.org/t/${TAG}/signin?token=${TOKEN}&lang=es`,
    );
    const refused = await refuseMissingBedScreen(request, `/t/${TAG}`);
    const location = refused.headers.get('location')!;

    expect(refused.status).toBe(302);
    expect(location).not.toContain(TOKEN);
    expect(location).not.toContain('token');
    expect(location).toBe(`/t/${TAG}?lang=es`);
  });

  it('answers a POST 303, still without the token', async () => {
    const request = new Request(`https://trashtalknyc.org/t/${TAG}/signin?token=${TOKEN}`, {
      method: 'POST',
      body: new URLSearchParams({ token: TOKEN }),
    });
    const refused = await refuseMissingBedScreen(request, `/t/${TAG}`);

    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe(`/t/${TAG}`);
  });
});

describe('the hop out of an unbound tag', () => {
  it('drops the sign-in token there too', async () => {
    const request = new Request(
      `https://trashtalknyc.org/t/${UNBOUND_TAG.toUpperCase()}/signin?token=${TOKEN}&lang=es`,
    );
    const { bound, refused } = await requireBoundTagForForm(UNBOUND_TAG.toUpperCase(), request);

    expect(bound).toBeNull();
    const location = refused!.headers.get('location')!;
    expect(location).not.toContain(TOKEN);
    expect(location).toBe(`/t/${UNBOUND_TAG}?lang=es`);
  });
});

describe('the query string one of our redirects may carry', () => {
  it('drops the token and keeps everything a decorated tag URL holds', () => {
    const request = new Request(
      `https://trashtalknyc.org/t/${TAG}/m?token=${TOKEN}&lang=es&utm_source=popl`,
    );

    const search = forwardableSearch(request);
    expect(search).not.toContain(TOKEN);
    expect(search).not.toContain('token');
    expect(search).toContain('lang=es');
    expect(search).toContain('utm_source=popl');
  });

  it('is an empty string for a bare URL, so no redirect grows a "?"', () => {
    expect(forwardableSearch(new Request(`https://trashtalknyc.org/t/${TAG}/m`))).toBe('');
  });
});
