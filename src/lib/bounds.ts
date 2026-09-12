/**
 * A bound the end-to-end suite can lower, so the paths that only open at
 * capacity can be driven with two sockets instead of several hundred. Not a
 * deployment knob: the shipped values are the defaults at each call site, and
 * a bad one throws where it is read rather than leaving a bound that silently
 * isn't there. That throw lands on a request, not at boot — the adapter
 * imports the middleware and every route chunk lazily (see src/middleware.ts),
 * so nothing here is read until traffic arrives.
 *
 * Lives on its own so that "a bound must be a non-negative number" is decided
 * in one place for every bound on a public request, whichever module holds it.
 * Today that is only the transport bounds in `request-body.ts` — the CPU bound
 * that shared it left with the PIN path — and it stays a module of its own
 * because the next such bound belongs here rather than beside its one caller.
 */
export function boundFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return value;
}
