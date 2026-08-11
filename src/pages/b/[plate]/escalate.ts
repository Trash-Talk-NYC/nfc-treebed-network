// POST: raise the open report to DUMPING. Anyone may escalate; the
// only-upward / only-once rules are enforced in the service layer.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { RuleError, escalateReport } from '../../../lib/service';
import { getActorId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const refused = await discardBody(request, 'update');
  if (refused) return refused;
  try {
    await escalateReport(getStore(), { plate, actorId: getActorId(cookies) });
    return redirect(`/b/${plate}?raised=1`, 303);
  } catch (err) {
    if (err instanceof RuleError && (err.code === 'no-open-report' || err.code === 'already-dumping')) {
      return redirect(`/b/${plate}`, 303);
    }
    throw err;
  }
};
