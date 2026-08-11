// POST: "I CLEANED IT — CLOSE THE REPORT". Anyone can mark clear, not just
// adopters (spec §2) — otherwise stale reports read as adopter neglect.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { RuleError, closeReport } from '../../../lib/service';
import { getActorId, getSessionUserId } from '../../../lib/session';

export const POST: APIRoute = async ({ params, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const signedIn = getSessionUserId(cookies) !== null;
  const back = signedIn ? `/b/${plate}/mine` : `/b/${plate}`;
  try {
    await closeReport(getStore(), { plate, actorId: getActorId(cookies) });
    return redirect(back, 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'no-open-report') return redirect(back, 303);
    throw err;
  }
};
