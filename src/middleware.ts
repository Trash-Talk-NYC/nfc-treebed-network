// The one thing that has to be true before any screen renders.
//
// A production deploy without TREEBED_SESSION_SECRET can't sign a cookie, and
// the failure used to wait for the first request that touched one — long
// enough for a health check to pass. Asserting at module load moves it ahead
// of every route: the adapter resolves this module before it renders anything,
// so a misconfigured server fails on its first request of any kind.
import { assertSessionSecret } from './lib/session';

assertSessionSecret();

export function onRequest(_context: unknown, next: () => Promise<Response>): Promise<Response> {
  return next();
}
