// The tag URL's DECORATION suffix: /t/<id>/m redirects to /t/<id>.
//
// The captain's ask (2026-09-12): the chips on metal-guarded beds carry
// `<site>/t/<id>/m` — the `/m` "denotes if it's metal or not", legible to a
// human reading the tag — and it is DECORATION ONLY: "yes that's right,
// decoration only." So this route answers every /t/<tag>/<suffix> path no
// named sibling route claims, and does exactly one thing with a known
// decoration: sends the visitor to the bare bed URL, query string intact.
//
// The app NEVER reads the suffix to decide anything about the bed. Which
// guard a bed carries is `Bed.guard`, recorded on the admin page — the single
// source of truth for material. If this route ever branched on `/m` the chip
// and the record would drift apart the day a guard is replaced, because
// re-encoding a chip means physically visiting it and editing a record does
// not. The one branch below is routing, not reading: a recognized decoration
// redirects, anything else is 404 — a suffix is not a screen.
//
// Named sibling routes (`/mine`, `/care`, `/about`, the POST endpoints…) are
// static segments, which Astro matches ahead of this dynamic one, so `/m`
// can never shadow `/mine` and this file can never swallow a real screen.
import type { APIRoute } from 'astro';

import { abandonBody } from '../../../lib/request-body';
import { normalizeTagId } from '../../../lib/tag-id';

/** The suffixes a chip may carry, lowercase. Today: `m`, the metal-guard marker. */
const DECORATIONS = new Set(['m']);

export const ALL: APIRoute = async ({ params, request }) => {
  // The body (a hand-built POST's, say) is accounted for before any answer,
  // like every refusal on this surface: an unconsumed body is one Node dumps
  // to its end for us (request-body.ts).
  await abandonBody(request);
  const suffix = (params.suffix ?? '').toLowerCase();
  const tag = normalizeTagId(params.tag ?? '');
  // An ID no normalization can resolve is not on this network at all — the
  // same plain-text 404 every route gives it, decoration or not.
  if (tag === null || !DECORATIONS.has(suffix)) {
    return new Response('Not a tag on this network.', { status: 404 });
  }
  // Straight to the canonical bed URL — one hop, whatever casing the chip or
  // a hand typed. The door screen owns everything from here: the bed's state,
  // the calm screen for an unbound tag, and the tap count (a redirected tap
  // arrives as a plain GET of the bare URL, which is exactly one tap). 303
  // for anything that arrived with a body, as every redirect that can answer
  // a POST here does (RFC 9110: a 302 invites repeating the POST).
  const seeOther = request.method !== 'GET' && request.method !== 'HEAD';
  return new Response(null, {
    status: seeOther ? 303 : 302,
    headers: { location: `/t/${tag}${new URL(request.url).search}` },
  });
};
