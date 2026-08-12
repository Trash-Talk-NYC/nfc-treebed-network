// What has to be true, or said out loud, before any screen renders.
//
// A production deploy without TREEBED_SESSION_SECRET can't sign a cookie, and
// the failure used to wait for the first request that touched one — long
// enough for a health check to pass. Asserting at module load moves it ahead
// of every route: the adapter resolves this module before it renders anything,
// so a misconfigured server fails on its first request of any kind.
//
// A PIN-hash bound of zero disables sign-in and adoption the same way, quietly
// rather than fatally, and belongs beside it for the same reason: at
// service.ts's own module scope the warning waits for the first request that
// happens to load a route chunk importing it, which on this app can be several
// screens in. Neither line here is a boot check — the adapter imports this
// module lazily too (`middleware: () => import(...)` in the built manifest),
// so both fire on the first request of any route. scripts/preflight.mjs is
// what runs before the port is bound.
import { assertSessionSecret } from './lib/session';
import { warnIfPinHashingDisabled } from './lib/service';

assertSessionSecret();
warnIfPinHashingDisabled();

export function onRequest(_context: unknown, next: () => Promise<Response>): Promise<Response> {
  return next();
}
