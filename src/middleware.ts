// What has to be true, or said out loud, before any screen renders.
//
// A production deploy without TREEBED_SESSION_SECRET can't sign a cookie, and
// the failure used to wait for the first request that touched one — long
// enough for a health check to pass. Asserting at module load moves it ahead
// of every route: the adapter resolves this module before it renders anything,
// so a misconfigured server fails on its first request of any kind.
//
// The request context installed below is not a check at all; it is here
// because middleware is the one place that wraps every route's work.
//
// A PIN-hash bound of zero disables sign-in and adoption the same way, quietly
// rather than fatally, and belongs beside it for the same reason: at
// service.ts's own module scope the warning waits for the first request that
// happens to load a route chunk importing it, which on this app can be several
// screens in. Neither line here is a boot check — the adapter imports this
// module lazily too (`middleware: () => import(...)` in the built manifest),
// so both fire on the first request of any route. scripts/preflight.mjs is
// what runs before the port is bound.
//
// It is also where the last unread body is accounted for. Only the method a
// route exports is bounded by that route: Astro answers every other one with a
// bare 404 of its own, and an Astro page renders for a PUT as readily as for a
// tap — in both cases without touching the body, which is the answer Node then
// dumps to its end for us. Draining once here, after the response is decided,
// covers every route and every method at once, and costs nothing on the paths
// that already read their body: `abandonBody` returns immediately for a stream
// that is used or locked.
import type { APIContext, MiddlewareNext } from 'astro';

import { runInRequestContext } from './lib/request-context';
import { assertSessionSecret } from './lib/session';
import { warnIfPinHashingDisabled } from './lib/service';
import { abandonBody } from './lib/request-body';

assertSessionSecret();
warnIfPinHashingDisabled();

// Everything a route awaits runs inside one request context, which is what
// lets the store validate its dataset once per request instead of once per
// read (src/lib/request-context.ts).
export async function onRequest(context: APIContext, next: MiddlewareNext): Promise<Response> {
  const response = await runInRequestContext(next);
  await abandonBody(context.request);
  return response;
}
