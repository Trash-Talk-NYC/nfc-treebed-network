// One mutable slot that lives exactly as long as one request.
//
// The store is a process-wide singleton and its reads are individually
// consistent, but a single render makes several of them, and on a remote
// backend each one is a network round trip on the critical tap path. This is
// where a backend can memoize the dataset it validated for the request it is
// serving — one revalidation per request instead of one per read, and one
// revision observed by every read on a screen rather than possibly two.
//
// AsyncLocalStorage rather than a parameter because the store is reached
// through `getStore()` from a dozen routes, and threading a request object
// into every read would put transport in the persistence contract. Absent
// outside a request (the unit suites, a script), where every read simply
// revalidates as before.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /**
   * Each store's memoized read for this request, keyed by the store that made
   * it so two of them can never be handed each other's dataset. Owned by the
   * store implementations — nothing else reads or writes it.
   */
  readonly storeReads: Map<unknown, Promise<unknown>>;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` (and everything it awaits) with a context of its own. */
export function runInRequestContext<T>(fn: () => T): T {
  return storage.run({ storeReads: new Map() }, fn);
}

/** The current request's context, or undefined outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
