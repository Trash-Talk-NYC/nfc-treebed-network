// POST: "I CLEANED IT — CLOSE THE REPORT". Anyone can mark clear, not just
// adopters (spec §2) — otherwise stale reports read as adopter neglect.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { RuleError, closeReport } from '../../../lib/service';
import { getExistingActorId, getSessionUserId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { ourPlaqueLink } from '../../../lib/plaque-url';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const refused = await discardBody(request, 'update');
  if (refused) return refused;
  const signedIn = getSessionUserId(cookies) !== null;
  // The guardian's own view logs no tap; the plaque does, so the anonymous way
  // back carries the flag that says this render is our redirect, not a visit.
  const back = signedIn ? `/b/${plate}/mine` : ourPlaqueLink(`/b/${plate}`);
  // Closing a report is what lets the next one be filed, so a caller that
  // sends no cookie can run report → clear → report forever, and every lap
  // appends a report and two events to a history nothing prunes. Minting an
  // identity here is what would make that free; a real neighbour always has
  // the cookie, because the plaque GET they pressed this button on set it.
  const actorId = getExistingActorId(cookies);
  if (!actorId) return redirect(back, 303);
  try {
    await closeReport(getStore(), { plate, actorId });
    return redirect(back, 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'no-open-report') return redirect(back, 303);
    throw err;
  }
};
