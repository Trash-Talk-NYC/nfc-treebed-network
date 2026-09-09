// What every route behind /t/<tag> does before it does anything else.
//
// One place, because the three states a tapped URL can be in (tag-bindings.ts)
// have one answer each and the answers are not interchangeable: an invalid ID
// is not on this network at all, an unbound one is a normal state that belongs
// on the calm plaque screen, and only a bound one has a site to key reads by.
// Nine routes repeating that by hand is nine chances for one of them to drift —
// on the wording, on the canonical base it builds links from, or on the part
// that is load-bearing rather than cosmetic: a POST that answers before it has
// touched its body leaves the body to Node, which reads it to the end
// (`abandonBody`).

import { abandonBody } from './request-body';
import { resolveTagParam } from './tag-bindings';

/** A tag that resolves to a site, and everything a route builds from it. */
export interface BoundTag {
  /** The canonical tag ID, as the chip carries it. */
  tag: string;
  /** The site the tag speaks for, as the store keys it. */
  plate: string;
  /** The canonical URL prefix for this tag: `/t/<tag>`. */
  base: string;
}

/** A resolved tag, or the answer to send in place of the screen. */
export type TagRoute = { bound: BoundTag; refused: null } | { bound: null; refused: Response };

function bind(tag: string, plate: string): TagRoute {
  return { bound: { tag, plate, base: `/t/${tag}` }, refused: null };
}

/**
 * Resolve the `[tag]` param for a screen that reads its own body.
 *
 * An unbound tag goes to the plaque rather than answering here: the calm "not
 * assigned to a bed yet" screen already exists there, carries the ID, and is
 * the one place that decides what an unbound tag looks like. A sub-page
 * bookmarked before the tag was retired, or tapped between a visitor's tap and
 * their pressing a button, lands on that instead of a line of unstyled text.
 * The plaque answers 404 for it, so the status a crawler sees is unchanged.
 *
 * The request comes in because two of these screens (`adopt`, `auth`) also
 * take a POST, and a refusal that has not touched its body is the expensive
 * kind: Node dumps an unconsumed body to its end. Refusing goes through
 * `abandonBody` for that reason, which is a no-op for the GET that has no body
 * at all — so the ordering is kept here rather than in nine callers.
 */
export async function requireBoundTagForForm(
  rawTag: string | undefined,
  request: Request,
): Promise<TagRoute> {
  const resolved = resolveTagParam(rawTag);
  if (resolved.state === 'bound') return bind(resolved.tag, resolved.plate);
  const refused =
    resolved.state === 'invalid'
      ? new Response('Not a tag on this network.', { status: 404 })
      : new Response(null, { status: 302, headers: { location: `/t/${resolved.tag}` } });
  await abandonBody(request);
  return { bound: null, refused };
}

/**
 * The same for a screen that never reads a body at all.
 *
 * `mine`, `too-large` and the receipt are rendered by Astro for any method, so
 * a hand-built POST reaches them exactly as a tap does — and one they answer
 * without touching is one Node dumps to its end. Draining here rather than in
 * each of them keeps that with the resolution it belongs to: a screen with no
 * form on it has nothing to say about a body, only somewhere to stop reading
 * it. A GET has none, so this is a no-op on every real visit.
 */
export async function requireBoundTagForView(
  rawTag: string | undefined,
  request: Request,
): Promise<TagRoute> {
  const route = await requireBoundTagForForm(rawTag, request);
  await abandonBody(request);
  return route;
}

/**
 * Refuse from a screen or route that has already resolved its tag.
 *
 * The same reason as above: a 404 for a binding whose site has gone missing is
 * still an answer given without reading the body that came with it.
 */
export async function refuseWithBody(request: Request, response: Response): Promise<Response> {
  await abandonBody(request);
  return response;
}

/**
 * The same for a POST, which has a body to account for.
 *
 * Our own forms only ever post at a bound tag, so a request here is
 * hand-built — but refusing it without reading its body would hand Node an
 * unconsumed body to dump, which is the most expensive way to say no. The
 * bounded drain in `abandonBody` costs kilobytes and keeps the socket live
 * enough to carry this 404, and no rule, store read or write happens on the
 * way. Plain text rather than the plaque: nothing is submitting a form here.
 */
export async function requireBoundTagForPost(
  rawTag: string | undefined,
  request: Request,
): Promise<TagRoute> {
  const resolved = resolveTagParam(rawTag);
  if (resolved.state === 'bound') return bind(resolved.tag, resolved.plate);
  await abandonBody(request);
  return { bound: null, refused: new Response('No bed bound to that tag.', { status: 404 }) };
}
