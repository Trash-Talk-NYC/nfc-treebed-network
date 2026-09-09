// POST: raise the open report to DUMPING. Anyone may escalate; the
// only-upward / only-once rules are enforced in the service layer.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { RuleError, escalateReport } from '../../../lib/service';
import { getExistingActorId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { ourPlaqueLink } from '../../../lib/plaque-url';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const refused = await discardBody(request, 'update');
  if (refused) return refused;
  // Same gate as /confirm: a write a cookie-less caller can repeat is a write
  // that costs an event apiece and bounds nothing. The escalation itself only
  // happens once per report, but the event beside it does not. /clear is
  // stricter than both — see its own header comment for why a cookie is not
  // enough there.
  const actorId = getExistingActorId(cookies);
  if (!actorId) return redirect(ourPlaqueLink(`/b/${plate}`), 303);
  try {
    await escalateReport(getStore(), { plate, actorId });
    return redirect(`/b/${plate}?raised=1`, 303);
  } catch (err) {
    if (err instanceof RuleError && (err.code === 'no-open-report' || err.code === 'already-dumping')) {
      return redirect(ourPlaqueLink(`/b/${plate}`), 303);
    }
    throw err;
  }
};
