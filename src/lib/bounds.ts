/**
 * A bound the end-to-end suite can lower, so the paths that only open at
 * capacity can be driven with two sockets instead of several hundred. Not a
 * deployment knob: the shipped values are the defaults at each call site, and
 * a bad one is a boot failure rather than a bound that silently isn't there.
 *
 * Lives on its own because both things that bound a public request read it —
 * the transport bounds in `request-body.ts` and the CPU bound in `service.ts`
 * — and one parser is one place for "a bound must be a non-negative number".
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
