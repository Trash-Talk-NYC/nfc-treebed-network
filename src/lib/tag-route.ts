// What every route behind /t/<tag> does before it does anything else.
//
// One place, because the three states a tapped URL can be in (tag-bindings.ts)
// have one answer each and the answers are not interchangeable: an invalid ID
// is not on this network at all, an unbound one is a normal state that belongs
// on the calm plaque screen, and only a bound one has a site to key reads by.
// A dozen routes repeating that by hand is a dozen chances for one to drift —
// on the wording, on the canonical base it builds links from, or on the part
// that is load-bearing rather than cosmetic: a POST that answers before it has
// touched its body leaves the body to Node, which reads it to the end
// (`abandonBody`).

import type { APIRoute } from 'astro';

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
 * Query parameters that may never be forwarded by one of our own redirects.
 *
 * `token` is the sign-in link's raw, UNBURNED secret (`/t/<tag>/signin`): a
 * GET spends nothing, so it stays a live credential for its full 15 minutes.
 * Forwarding it would put it in a `location` header — which is what platform
 * access logs keep — and then in the address bar of the door screen, which
 * sets no `no-store` and whose language-toggle links are built from the URL
 * it arrived on, carrying the secret on again.
 *
 * It is stripped HERE rather than at the one route that mints it, because
 * every hop out of a `/t/<tag>` sub-page goes through this file: an unbound
 * tag and a retired bed both bounce the signin screen to the door, and a
 * rule kept at one of the two call sites is a rule the other one breaks.
 */
const SECRET_QUERY_PARAMS: readonly string[] = ['token'];

/**
 * The query string one of our redirects may carry forward.
 *
 * Everything else rides along, as the plaque's own canonical redirect does:
 * it may hold the language a cookie-refusing visitor picked, our post-action
 * flag, or a decoration (UTM, a link shortener) the tag URL was given.
 */
function forwardableSearch(request: Request): string {
  const url = new URL(request.url);
  for (const param of SECRET_QUERY_PARAMS) url.searchParams.delete(param);
  return url.search;
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
 * The request comes in because three of these screens (`adopt`, `auth`,
 * `signin`) also take a POST, and a refusal that has not touched its body is
 * the expensive kind: Node dumps an unconsumed body to its end. Refusing goes
 * through `abandonBody` for that reason, which is a no-op for the GET that has
 * no body at all — so the ordering is kept here rather than in every caller.
 */
export async function requireBoundTagForForm(
  rawTag: string | undefined,
  request: Request,
): Promise<TagRoute> {
  const resolved = resolveTagParam(rawTag);
  if (resolved.state === 'bound') return bind(resolved.tag, resolved.plate);
  // 303 for anything that arrived with a body, as every other post-action
  // redirect in the build does: a 302 invites a client reading RFC 9110 to
  // repeat the POST at the plaque, which is the one screen that logs a tap.
  const seeOther = request.method !== 'GET' && request.method !== 'HEAD';
  const refused =
    resolved.state === 'invalid'
      ? new Response('Not a tag on this network.', { status: 404 })
      : new Response(null, {
          status: seeOther ? 303 : 302,
          // The query string rides along minus anything secret
          // (`forwardableSearch`).
          headers: { location: `/t/${resolved.tag}${forwardableSearch(request)}` },
        });
  await abandonBody(request);
  return { bound: null, refused };
}

/**
 * The same for a screen that never reads a body at all.
 *
 * `mine`, `care`, the two takeovers and `too-large` are rendered by Astro for
 * any method, so
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

/**
 * The answer to a method one of these routes does not export.
 *
 * Astro's own fallback is a bare 404 plus a `logger.warn` line per request,
 * which hands an anonymous caller the same control over stderr volume that
 * `noteShedPinHash` and the silent `busy` refusal exist to deny it. 405 with
 * `allow` is the truthful answer anyway — the path exists, the verb doesn't —
 * and the body that came with it is drained by `src/middleware.ts`, which
 * accounts for every method on every route in one place.
 */
export const postOnly: APIRoute = () =>
  new Response(null, { status: 405, headers: { allow: 'POST' } });

/**
 * Refuse a SCREEN whose bound tag resolves to no bed the rules will serve.
 *
 * A bed deleted on the admin page is retired, not erased (service.ts,
 * `retireBedByAdmin`), so `getBedView` answering null for a bound tag is a
 * normal state rather than a registry typo — and the answer to it already
 * exists: the door screen renders the calm, bilingual "not assigned to a bed
 * yet" screen and answers 404 itself. Every sub-page goes there rather than
 * inventing a line of unstyled English, for the same reason an unbound tag
 * does in `requireBoundTagForForm`. The query string rides along so the
 * language a visitor picked survives the hop — minus anything secret, which
 * on this hop is the signin screen's live token (`SECRET_QUERY_PARAMS`) —
 * and a body that arrived with the request is accounted for before the
 * answer is written.
 */
export async function refuseMissingBedScreen(request: Request, base: string): Promise<Response> {
  const seeOther = request.method !== 'GET' && request.method !== 'HEAD';
  await abandonBody(request);
  return new Response(null, {
    status: seeOther ? 303 : 302,
    headers: { location: `${base}${forwardableSearch(request)}` },
  });
}
