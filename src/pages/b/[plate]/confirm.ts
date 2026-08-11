// POST: "STILL THERE — CONFIRM IT". Idempotent per person, server-enforced.
import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store-local';
import { RuleError, confirmReport } from '../../../lib/service';
import { getActorId } from '../../../lib/session';

export const POST: APIRoute = async ({ params, cookies, redirect }) => {
  const plate = params.plate ?? '';
  try {
    await confirmReport(getStore(), { plate, actorId: getActorId(cookies) });
    return redirect(`/b/${plate}?confirmed=1`, 303);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'no-open-report') return redirect(`/b/${plate}`, 303);
    throw err;
  }
};
