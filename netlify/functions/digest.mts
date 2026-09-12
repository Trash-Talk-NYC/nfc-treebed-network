// The steward digest's clock: a Netlify scheduled function, daily.
//
// Deliberately a thin shell — everything it does lives in src/lib/digest.ts,
// which the unit suite exercises, because this file is the one piece of the
// app Netlify bundles OUTSIDE the Astro/Vite build (its own esbuild, at
// deploy). That is why nothing on this import path may touch a Vite define
// or `import.meta.env`: `build-target.ts` already tolerates the missing
// define (it answers 'node' here, so the store is selected by the runtime
// TREEBED_STORE, which this file asserts for itself below because that same
// missing define disarms getStore()'s own netlify guard), and digest.ts
// resolves its signing secret from the environment alone.
//
// Daily, not "weekly", on purpose: the cadence is a stored network setting
// the captain edits (off / weekly / every two weeks / monthly), so the
// schedule just asks every day and `runDigest` sends only to stewards whose
// cadence has elapsed. Idempotence is the claim-then-send inside runDigest,
// so an extra invocation double-sends nothing.
//
// Environment this function needs on the site (runtime, not build):
// TREEBED_STORE=blobs, TREEBED_SESSION_SECRET (shared with the app — the
// unsubscribe links are signed with it), BREVO_API_KEY, TREEBED_MAIL_FROM,
// and TREEBED_PUBLIC_ORIGIN for the absolute links. Missing mail config is
// a logged no-op, never a crash: the tap flow owes nothing to the digest.

import { getStore } from '../../src/lib/store';
import { runDigest } from '../../src/lib/digest';
import { mailAvailable, publicOrigin } from '../../src/lib/mail';

export default async (): Promise<Response> => {
  // `getStore()` refuses the disk store on the netlify target, but that guard
  // reads BUILD_TARGET, which is a Vite define this bundle does not carry — it
  // answers 'node' here, so the guard cannot fire. Assert the runtime variable
  // directly instead: unset or renamed, the digest would otherwise build a
  // LocalStore against a function instance's ephemeral filesystem and quietly
  // read an empty dataset rather than refusing loudly.
  if (process.env.TREEBED_STORE !== 'blobs') {
    throw new Error(
      `TREEBED_STORE must be 'blobs' for the scheduled digest — got ${process.env.TREEBED_STORE ?? '(unset)'}.`,
    );
  }
  const origin = publicOrigin();
  if (!mailAvailable() || origin === null) {
    console.warn(
      '[digest] mail is not configured (BREVO_API_KEY / TREEBED_MAIL_FROM / TREEBED_PUBLIC_ORIGIN) — nothing sent',
    );
    return new Response('mail not configured', { status: 200 });
  }
  const result = await runDigest(getStore(), { origin });
  // Counts only — never an address, never a token.
  console.log(
    `[digest] cadence=${result.cadence} sent=${result.sent} failed=${result.failed}`,
  );
  return Response.json(result);
};

export const config = {
  // 06:00 ET is 10:00/11:00 UTC depending on DST; 11:00 UTC keeps the send
  // in every steward's morning year-round without a DST-aware schedule.
  schedule: '0 11 * * *',
};
