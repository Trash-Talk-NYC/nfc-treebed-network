// POST: "STILL THERE — CONFIRM IT". Idempotent per person, server-enforced.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { RuleError, confirmReport } from '../../../lib/service';
import { getActorId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { plaqueAfterAction } from '../../../lib/plaque-url';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const refused = await discardBody(request, 'confirmation');
  if (refused) return refused;
  try {
    await confirmReport(getStore(), { plate, actorId: getActorId(cookies) });
    return redirect(`/b/${plate}?confirmed=1`, 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'no-open-report') {
      return redirect(plaqueAfterAction(`/b/${plate}`), 303);
    }
    throw err;
  }
};
