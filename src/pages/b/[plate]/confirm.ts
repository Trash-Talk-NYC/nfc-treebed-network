// POST: "STILL THERE — CONFIRM IT". Idempotent per person, server-enforced.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { RuleError, confirmReport } from '../../../lib/service';
import { getExistingActorId } from '../../../lib/session';
import { discardBody } from '../../../lib/request-body';
import { ourPlaqueLink } from '../../../lib/plaque-url';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const plate = params.plate ?? '';
  const refused = await discardBody(request, 'confirmation');
  if (refused) return refused;
  // Once per person only counts if the person is the same one twice: minting
  // an identity here would give a caller that sends no cookie a new one every
  // time, and the count on the plaque is a number neighbours read. A visitor
  // who tapped the tag already has one, so this costs nobody their confirm —
  // it takes a scripted cookie-less client to land here at all.
  const actorId = getExistingActorId(cookies);
  if (!actorId) return redirect(ourPlaqueLink(`/b/${plate}`), 303);
  try {
    await confirmReport(getStore(), { plate, actorId });
    return redirect(`/b/${plate}?confirmed=1`, 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'no-open-report') {
      return redirect(ourPlaqueLink(`/b/${plate}`), 303);
    }
    throw err;
  }
};
